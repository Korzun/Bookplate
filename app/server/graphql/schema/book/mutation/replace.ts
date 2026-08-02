import * as fs from 'fs';

import { z } from 'zod';

import { logger } from '../../../../logger';
import {
  type ApplyEpubChangesDeps,
  replaceEpubBytes,
} from '../../../../services/apply-epub-changes';
import { BookHashCollisionError } from '../../../../services/book-store';
import { applyAutoAndAccepted } from '../../../../services/epub-import-pipeline';
import { EpubValidationError } from '../../../../services/epub-validator';
import { repairPackageDocument } from '../../../../services/epub-writer';
import { stagingIdentityOf } from '../../../../services/replace-staging';
import type { Book, Owner } from '../../../../types';
import { assertUnreachableStoreError, toResult } from '../../../to-result';
import {
  bookHashCollisionError,
  model as bookHashCollisionErrorModel,
} from '../../book-hash-collision-error/model';
import { builder } from '../../builder';
import {
  epubValidationError,
  model as epubValidationErrorModel,
} from '../../epub-validation-error/model';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { NO_MATCH_USER_ID, parseCompoundId } from '../../node-scope';
import {
  model as stagedUploadNotFoundErrorModel,
  stagedUploadNotFoundError,
} from '../../staged-upload-not-found-error/model';
import { model as bookType } from '../model';

/**
 * The `Book` global ID IS the input's `id` field — no separate `userId`/
 * `bookId` pair. Same shape as `bookValidate`'s `BookValidateInput` (see that
 * file's doc comment for the full rationale): the id's compound-key local
 * part already carries the owner, so decoding it at the resolver boundary
 * yields both halves the old two-argument shape used to require. This is
 * independent of who may consume the staged upload named by
 * `stagedUploadId` — that identity is always `context.viewer.userId`, the
 * literal authenticated caller, never the decoded owner. `acceptedFixKeys`
 * mirrors REST's `acceptedFixKeys` body field — already a real
 * `[String!]!` list here, so (unlike REST's
 * `JSON.parse(req.body.acceptedFixKeys ?? '[]')` with a malformed-JSON
 * fallback to `[]`) there is no parse failure this input can ever hit: a
 * value that reaches the resolver is already the correctly-typed shape REST
 * had to parse a string into — same reasoning as `bookUpdateMetadataInput`'s
 * `identifiers`/`subjects` (see that file's doc comment).
 */
const input = builder.inputType('BookReplaceInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: bookType }),
    stagedUploadId: t.string({ required: true }),
    acceptedFixKeys: t.stringList({ required: true }),
  }),
});

const inputSchema = z.object({
  stagedUploadId: z.string().min(1, 'stagedUploadId must not be empty'),
});

type BookReplacePayloadShape = {
  readonly __typename: 'BookReplacePayload';
  readonly owner: Owner;
  readonly bookId: string;
};

/**
 * `book` is a fresh `t.prismaField` lookup keyed by owner + the post-replace
 * id, exactly like `BookUpdateMetadataPayload.book`/`BookRegenChaptersPayload.
 * book` — see the former's doc comment for why the store's `Book` DTO cannot
 * back this type's field resolvers directly. A successful replace always
 * changes the book's id (the new content's fingerprint), so this must
 * re-read by the id the store call actually returned, never the decoded
 * `id`'s local part.
 */
const payload = builder.objectRef<BookReplacePayloadShape>('BookReplacePayload').implement({
  fields: (t) => ({
    book: t.prismaField({
      type: bookType,
      resolve: (query, parent, _args, context) =>
        context.prisma.book.findUniqueOrThrow({
          ...query,
          where: { userId_id: { userId: parent.owner.userId, id: parent.bookId } },
        }),
    }),
  }),
});

const log = logger('bookReplace');

/**
 * Best-effort structural repair, mirroring REST's identical guard
 * (`routes/ui.ts:1392-1403`, warn-and-continue): on failure, fall back to the
 * staged file's own original bytes so `replaceEpubBytes`'s own validation
 * still runs (a normal typed error or success) instead of a bare 500. The
 * `try`/`catch` is kept out of `resolve`'s own body — same as `regen-
 * chapters.ts`'s `assertReimportSucceeded` — so "resolver bodies: zero
 * try/catch/throw" holds literally, not just in spirit; `toResult` stays the
 * one boundary for the seven declared store errors, and this is not one of
 * them (REST's own guard is not a `catch`-a-declared-error site either — it
 * only ever swallows `repairPackageDocument`'s own possible throw, never
 * calls `toResult`, and doesn't discharge anything the union declares).
 *
 * Logs on failure with the exact message shape REST's own guard produces
 * (`routes/ui.ts:1397-1399`, `Package repair skipped for "<name>": <message>`)
 * — review finding M-2: the first draft swallowed this silently, making a
 * systematically unrepairable candidate invisible in the logs on the
 * GraphQL path even though `analyzeEpub`'s own internal guard still logs.
 */
function repairBestEffort(stagedPath: string, originalName: string): Buffer {
  try {
    return repairPackageDocument(stagedPath).bytes;
  } catch (err: unknown) {
    log.warn(
      `Package repair skipped for "${originalName}": ${err instanceof Error ? err.message : String(err)}`
    );
    return fs.readFileSync(stagedPath);
  }
}

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('BookReplaceResult', {
  types: [
    payload,
    bookHashCollisionErrorModel,
    epubValidationErrorModel,
    stagedUploadNotFoundErrorModel,
    invalidInputErrorModel,
  ],
});

/**
 * Mirrors `POST /api/books/:id/replace` (`routes/ui.ts:1356-1439`), minus
 * the multipart upload half — see `replace-staging.ts`'s doc comment for the
 * staged-upload design, and `bookAnalyzeReplace`'s doc comment for the
 * owner-vs-staging identity split this mutation shares with it verbatim
 * (the decoded `id` resolves whose `Book` is targeted; `stagingIdentityOf
 * (context.viewer)` — never the decoded owner — is what the staged file is
 * keyed to). Input is the `Book` global ID alone (design doc's 10-mutation input
 * collapse), decoded with the same `parseCompoundId`/`NO_MATCH_USER_ID`
 * convention `bookValidate` established — see that file's resolver doc
 * comment for the full malformed-id / wrong-type-id reasoning, which applies
 * here unchanged.
 *
 * `repairPackageDocument` runs the same warn-and-continue best-effort guard
 * REST's route runs (`routes/ui.ts:1392-1403`): on failure, fall through to
 * the staged file's original bytes so `replaceEpubBytes`'s own validation
 * still runs (a normal typed error or success) instead of a bare 500.
 * Unlike REST, there is no throwaway tmp file to write-then-unlink around
 * this — `repairPackageDocument` reads directly from the staged path, which
 * `bookAnalyzeReplace` may have already repaired in place (idempotent either
 * way, see that file's doc comment).
 *
 * `replaceEpubBytes` is traced end to end (`apply-epub-changes.ts`): it
 * throws `EpubValidationError` when the candidate fails validation and
 * `BookHashCollisionError` when the new fingerprint collides — the same two
 * classes `bookUpdateMetadata` wraps for `applyEpubChanges`, which calls the
 * same function. `applyAutoAndAccepted` runs after and is NOT wrapped: its
 * own doc comment says it never fails the caller's request — a write failure
 * there comes back as an unapplied proposal, not a throw.
 *
 * CONSUME-ON-SUCCESS, NOT ON EVERY ATTEMPT: the staged file is only deleted
 * (`ReplaceStaging.consume`) once `replaceEpubBytes` has actually succeeded.
 * A typed failure (`EpubValidationError`, `BookHashCollisionError`,
 * `StagedUploadNotFoundError`) or an input-validation failure leaves the
 * staged entry alone, so the client can retry `bookReplace` with the exact
 * same `stagedUploadId` — fix the acceptedFixKeys, wait out a transient
 * collision, etc. — without re-uploading the file. REST re-uploads on every
 * retry by construction (each attempt is its own multipart request); this
 * mutation's whole reason to exist is to not require that a second time.
 * Abandoned staged files (the client gives up, or never retries) are left
 * for the lazy TTL sweep, not deleted here — see `replace-staging.ts`.
 * Flagging this as a real design choice, not an oversight: an alternative
 * (consume unconditionally, up front) would make every failed attempt force
 * a fresh upload, defeating half of what staging is for.
 */
builder.mutationField('bookReplace', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Replaces a book’s EPUB file with a previously staged upload, applying ' +
      'auto-fixes and any accepted proposals. Resolves to null when the book ' +
      'does not exist for the resolved owner.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args) => {
      const parsed = parseCompoundId(args.input.id.id);
      return { ownerOf: parsed === null ? NO_MATCH_USER_ID : parsed[0] };
    },
    resolve: async (_parent, args, context) => {
      const parsed = parseCompoundId(args.input.id.id);
      if (parsed === null) return null; // admin passed scope on a malformed id: same "no such row" convention
      const [userId, bookId] = parsed;

      const parsedInput = inputSchema.safeParse({ stagedUploadId: args.input.stagedUploadId });
      if (!parsedInput.success) return invalidInputError(parsedInput.error);

      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const targetBook = await context.stores.book.getBookById(owner, bookId);
      if (targetBook === null) return null;

      const stagingIdentity = stagingIdentityOf(context.viewer!);
      // `'epub'` explicit — see `bookAnalyzeReplace`'s identical note (Task
      // 3b generalized the registry to also hold `'cover'`-kind entries).
      const staged =
        stagingIdentity === null
          ? null
          : context.stores.replaceStaging.resolve(
              parsedInput.data.stagedUploadId,
              stagingIdentity,
              'epub'
            );
      if (staged === null) return stagedUploadNotFoundError();

      const repairedBytes = repairBestEffort(staged.path, staged.originalName);

      const deps: ApplyEpubChangesDeps = {
        bookStore: context.stores.book,
        validationStore: context.stores.validation,
        validationThreshold: context.config.validationThreshold,
      };

      const outcome = await toResult<Book, EpubValidationError | BookHashCollisionError>(
        () => replaceEpubBytes(deps, owner, targetBook, repairedBytes),
        [EpubValidationError, BookHashCollisionError]
      );
      if ('err' in outcome) {
        if (outcome.err instanceof EpubValidationError) return epubValidationError(outcome.err);
        if (outcome.err instanceof BookHashCollisionError) {
          return bookHashCollisionError(outcome.err, owner);
        }
        return assertUnreachableStoreError(outcome.err);
      }

      const applied = await applyAutoAndAccepted(deps, owner, outcome.ok, {
        originalName: staged.originalName,
        librarySubjects: await context.stores.book.getSubjects(owner),
        acceptedKeys: [...args.input.acceptedFixKeys],
      });

      context.stores.replaceStaging.consume(
        parsedInput.data.stagedUploadId,
        stagingIdentity!,
        'epub'
      );

      return {
        __typename: 'BookReplacePayload' as const,
        owner,
        bookId: applied.book.id,
      };
    },
  })
);

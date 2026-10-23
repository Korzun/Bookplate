import * as fs from 'fs';

import { z } from 'zod';

import { importUploadedEpub } from '../../../../services/book-upload';
import { EpubValidationError } from '../../../../services/epub-validator';
import type { MetadataFix, Owner } from '../../../../types';
import { model as bookHashCollisionErrorModel } from '../../book-hash-collision-error/model';
import { builder } from '../../builder';
import {
  epubValidationError,
  model as epubValidationErrorModel,
} from '../../epub-validation-error/model';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as metadataFixModel } from '../../metadata-fix/model';
import {
  model as stagedUploadNotFoundErrorModel,
  stagedUploadNotFoundError,
} from '../../staged-upload-not-found-error/model';
import { model as bookType } from '../model';

const input = builder.inputType('BookAddInput', {
  fields: (t) => ({
    stagedUploadId: t.string({ required: true }),
  }),
});

const inputSchema = z.object({
  stagedUploadId: z.string().min(1, 'stagedUploadId must not be empty'),
});

type BookAddPayloadShape = {
  readonly __typename: 'BookAddPayload';
  readonly owner: Owner;
  readonly bookId: string;
  readonly autoFixes: readonly MetadataFix[];
  readonly proposals: readonly MetadataFix[];
};

/**
 * `book` is a fresh `t.prismaField` lookup by the id the import reported — the
 * `BookReplacePayload.book` shape, for the same reason (see that file).
 * `autoFixes`/`proposals` mirror REST's upload response `applied`/`proposals`;
 * the proposals are also persisted as the book's pending fix, so they stay
 * reachable afterwards through `Book.pendingFix`.
 */
const payload = builder.objectRef<BookAddPayloadShape>('BookAddPayload').implement({
  fields: (t) => ({
    book: t.prismaField({
      type: bookType,
      resolve: (query, parent, _args, context) =>
        context.prisma.book.findUniqueOrThrow({
          ...query,
          where: { userId_id: { userId: parent.owner.userId, id: parent.bookId } },
        }),
    }),
    autoFixes: t.field({
      type: [metadataFixModel],
      description: 'Metadata fixes applied automatically during import.',
      resolve: (p) => p.autoFixes,
    }),
    proposals: t.field({
      type: [metadataFixModel],
      description: 'Suggested metadata fixes left for the reader to accept or dismiss.',
      resolve: (p) => p.proposals,
    }),
  }),
});

/**
 * The staged file's size, or `null` when it vanished between `resolve` and
 * here (the TTL sweep raced us). Kept out of the resolver body so "resolver
 * bodies: zero try/catch/throw" holds literally — `replace.ts`'s
 * `repairBestEffort` shape.
 */
function stagedFileSize(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

/** No `resolveType`: every member value carries its own `__typename`. */
const result = builder.unionType('BookAddResult', {
  types: [
    payload,
    bookHashCollisionErrorModel,
    epubValidationErrorModel,
    invalidInputErrorModel,
    stagedUploadNotFoundErrorModel,
  ],
});

/**
 * Adds a previously staged EPUB to the viewer's OWN library — the staged-upload
 * counterpart of `POST /api/books/upload`, running the exact same pipeline
 * (`services/book-upload.ts`). It exists so a client that can only stage bytes
 * and then call an operation — the MCP `add_book` tool — can add a book; the
 * web client still uploads through REST.
 *
 * Own library only: the config admin (no `sub`, no library) is refused by
 * `authScopes`, the `bookRequestCreate` gate. REST's admin `?user=` targeting
 * has no counterpart here yet — nothing needs it.
 *
 * The staged file is keyed to `viewer.userId`, which here is also the owner.
 *
 * Outcomes map onto existing union members rather than new ones:
 *  - unreadable (parse/fingerprint failure) and invalid both become
 *    `EpubValidationError` — the file was rejected as an EPUB either way; an
 *    unreadable one simply carries no checker messages.
 *  - a duplicate becomes `BookHashCollisionError`, whose `collidingBook` is
 *    exactly what a caller needs to act on ("you already have this").
 *
 * CONSUMED ON EVERY RETURNED OUTCOME, unlike `bookReplace`'s consume-on-success:
 * that mutation has caller-adjustable input (`acceptedFixKeys`) worth retrying
 * with the same bytes, whereas this one has none — a retry with the same staged
 * id can only fail the same way, so holding the file until the TTL sweep would
 * only waste disk. On success the import has already moved the file into the
 * library, and `consume` merely drops the registry entry. An unexpected throw
 * leaves the entry for the TTL sweep.
 */
builder.mutationField('bookAdd', (t) =>
  t.field({
    type: result,
    description:
      'Adds a previously staged EPUB to the viewer’s own library, validating it and ' +
      'detecting metadata fixes exactly as a web upload does.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, _args, context) => context.viewer?.userId != null,
    resolve: async (_parent, args, context) => {
      // Non-null by the `authScopes` above; this is the type narrowing.
      const userId = context.viewer?.userId ?? '';

      const parsedInput = inputSchema.safeParse({ stagedUploadId: args.input.stagedUploadId });
      if (!parsedInput.success) return invalidInputError(parsedInput.error);
      const { stagedUploadId } = parsedInput.data;

      const owner = await context.loadOwner(userId);
      if (owner === null) return stagedUploadNotFoundError();

      const staged = context.replaceStaging.resolve(stagedUploadId, userId, 'epub');
      if (staged === null) return stagedUploadNotFoundError();

      const size = stagedFileSize(staged.path);
      if (size === null) return stagedUploadNotFoundError();

      const outcome = await importUploadedEpub(
        {
          prisma: context.prisma,
          booksDir: context.config.booksDir,
          editionsRoot: context.editionsRoot,
          validationThreshold: context.config.validationThreshold,
          thumbnails: context.thumbnails,
        },
        owner,
        { path: staged.path, originalName: staged.originalName, size }
      );
      context.replaceStaging.consume(stagedUploadId, userId, 'epub');

      switch (outcome.kind) {
        case 'added':
          return {
            __typename: 'BookAddPayload' as const,
            owner,
            bookId: outcome.bookId,
            autoFixes: outcome.applied,
            proposals: outcome.proposals,
          };
        case 'invalid':
          return epubValidationError(
            new EpubValidationError(
              outcome.report.messages,
              outcome.report.counts,
              outcome.report.threshold
            )
          );
        case 'unreadable':
          return {
            __typename: 'EpubValidationError' as const,
            message: outcome.message,
            messages: [],
          };
        case 'duplicate':
          return {
            __typename: 'BookHashCollisionError' as const,
            message: 'This book is already in your library.',
            owner,
            collidingId: outcome.existingId,
          };
      }
    },
  })
);

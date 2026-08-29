import * as fs from 'fs';

import { z } from 'zod';

import {
  applyEpubChanges,
  type ApplyEpubChangesDeps,
} from '../../../../services/apply-epub-changes';
import { getBookById } from '../../../../services/book-catalog';
import { BookHashCollisionError } from '../../../../services/book-errors';
import { reimportBook } from '../../../../services/book-lifecycle';
import { EpubValidationError } from '../../../../services/epub-validator';
import type { EpubChanges } from '../../../../services/epub-writer';
import { stagingIdentityOf } from '../../../../services/replace-staging';
import type { Book, Owner } from '../../../../types';
import { assertUnreachableDomainError, toResult } from '../../../to-result';
import {
  bookHashCollisionError,
  model as bookHashCollisionErrorModel,
} from '../../book-hash-collision-error/model';
import {
  bookNotValidatedError,
  model as bookNotValidatedErrorModel,
} from '../../book-not-validated-error/model';
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
 * `routes/ui.ts`'s `ISO_8601_RE` (line ~47), duplicated rather than imported:
 * REST route modules stay untouched by this migration (spec's seams-that-stay-
 * REST boundary), so this schema cannot reach into `routes/ui.ts` without
 * creating exactly the kind of dependency the seam is meant to prevent. Keep
 * the two in sync by hand if the REST rule ever changes.
 */
const ISO_8601_RE = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;

const identifierInput = builder.inputType('IdentifierInput', {
  fields: (t) => ({
    scheme: t.string({ required: true }),
    value: t.string({ required: true }),
  }),
});

/**
 * JSON metadata fields, plus an optional staged-cover reference — mirrors
 * `PATCH /api/books/:id/metadata` (`routes/ui.ts`, removed in `e67b4ad9`),
 * whose multipart `coverUpload.single('cover')` field this input's
 * `stagedCoverId` now covers via the staging seam instead (spec §"Seams that
 * stay REST" → "Upload", amended 2026-08-01: "`bookUpdateMetadata` takes an
 * optional `stagedCoverId` so metadata and cover land in one mutation"). When
 * this was added the REST multipart-cover branch was left untouched and stayed
 * live alongside it — an addition, not a replacement — until `e67b4ad9` removed
 * that branch with the rest of the route.
 *
 * A field here left absent (`undefined`, not sent) leaves that column
 * unchanged, the same way `body.title !== undefined` gates each REST branch —
 * see the resolver's `buildChanges` for how that distinction is preserved.
 * `stagedCoverId` follows the identical convention: absent means "no cover
 * change", exactly like REST's `req.file` being unset when no `cover` part
 * was attached.
 *
 * The `Book` global ID IS the input's `id` field — no separate `userId`/
 * `bookId` pair. Same shape as `bookValidate`'s `BookValidateInput` (see that
 * file's doc comment for the full rationale): the id's compound-key local
 * part already carries the owner, so decoding it at the resolver boundary
 * yields both halves the old two-argument shape used to require.
 * `stagedCoverId` is a plain opaque string, not a `Book`-scoped or global id:
 * it names an entry in `services/replace-staging.ts`'s registry, keyed to the
 * *authenticated caller* (`context.viewer.userId`), never to the decoded
 * owner — see the resolver's doc comment for why those two identities can
 * differ and what happens when they do.
 */
const input = builder.inputType('BookUpdateMetadataInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: bookType }),
    title: t.string({ required: false }),
    titleSort: t.string({ required: false }),
    author: t.string({ required: false }),
    authorSort: t.string({ required: false }),
    publishDate: t.string({ required: false }),
    description: t.string({ required: false }),
    publisher: t.string({ required: false }),
    series: t.string({ required: false }),
    seriesIndex: t.float({ required: false }),
    identifiers: t.field({ type: [identifierInput], required: false }),
    subjects: t.stringList({ required: false }),
    stagedCoverId: t.string({ required: false }),
  }),
});

/**
 * `publishDate` mirrors REST exactly: `routes/ui.ts` trims it and, if
 * non-empty, checks `ISO_8601_RE`; every other field is copied through with
 * no validation at all (`body.title`, `body.author`, … are assigned as-is).
 * `seriesIndex`'s REST check (`parseFloat` + `NaN` rejection) and
 * `identifiers`/`subjects`' REST check (`JSON.parse` success) have no
 * GraphQL analogue to mirror: this input declares them as `Float` and
 * structured list types, so a value that would have failed REST's ad hoc
 * string parsing is rejected by GraphQL's own argument coercion before the
 * resolver runs at all, and a value that reaches the resolver is already the
 * correctly-typed shape REST had to parse strings into.
 *
 * `bookId` has no zod rule here — it is no longer a plain string field at
 * all, having been absorbed into the `id` global ID's compound-key local
 * part (`InvalidInputError` for an empty `bookId` is unreachable now the
 * same way it became unreachable for `bookDelete`'s identical field in task
 * 2: an id that doesn't parse is the `parsed === null` early return below,
 * not a zod issue).
 *
 * `stagedCoverId.min(1)` has no REST analogue at all (the field itself is
 * new) but follows the same "empty string is a client bug, not a valid
 * lookup" rule every other id-like field in this mutation set follows
 * (`stagedUploadId` in `bookAnalyzeReplace`/`bookReplace`).
 */
const inputSchema = z.object({
  publishDate: z
    .string()
    .refine((value) => {
      const trimmed = value.trim();
      return trimmed === '' || ISO_8601_RE.test(trimmed);
    }, 'publishDate must be a valid ISO 8601 date string')
    .optional(),
  stagedCoverId: z.string().min(1, 'stagedCoverId must not be empty').optional(),
});

type BookUpdateMetadataPayloadShape = {
  readonly __typename: 'BookUpdateMetadataPayload';
  readonly owner: Owner;
  readonly bookId: string;
};

/**
 * `book` is NOT the `types.Book` DTO `applyEpubChanges` returns: that DTO
 * (see `types.ts`) is REST's own response shape — no `userId`, already-parsed
 * `identifiers`/`subjects` arrays, already-`Date` `mtime`/`addedAt`, a
 * computed `hasCover` with no backing `coverMime` — none of which matches
 * what `book/model.ts`'s field resolvers read off their parent (raw Prisma
 * column values, `book.userId` present for `progress`/`lineage`/`pendingFix`/
 * `deviceEditionCount`). Handing that DTO to `Book`'s resolvers directly would
 * silently mis-render fields such as `hasCover` (`book.coverMime !== null` on
 * an object with no `coverMime` reads `undefined !== null`, always `true`)
 * rather than error.
 *
 * So, exactly like `BookHashCollisionError.collidingBook`
 * (`book-hash-collision-error/model.ts`), `book` is a fresh `t.prismaField`
 * lookup keyed by the owner + the post-edit id `applyEpubChanges` reported —
 * never the DTO itself. `findUniqueOrThrow` is safe here: the row the id
 * names was written by the very `applyEpubChanges` call that produced this
 * payload, inside the same request.
 */
const payload = builder
  .objectRef<BookUpdateMetadataPayloadShape>('BookUpdateMetadataPayload')
  .implement({
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

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('BookUpdateMetadataResult', {
  types: [
    payload,
    bookHashCollisionErrorModel,
    bookNotValidatedErrorModel,
    epubValidationErrorModel,
    invalidInputErrorModel,
    stagedUploadNotFoundErrorModel,
  ],
});

/**
 * Builds the same partial change-set REST builds from `req.body`, preserving
 * REST's "field absent leaves the column untouched" rule: a GraphQL input
 * field that was not included in the mutation's `input` object arrives as
 * `undefined` (never `null` — nothing here declares a default, so Pothos
 * leaves omission as `undefined`), exactly like REST's `body.title`. A client
 * that sends an explicit `null` is treated the same as omission for the same
 * reason REST has no way to express "clear this field" at all: form fields
 * are never `null`, only present-or-absent.
 *
 * `publishDate` is deliberately NOT one of `fields`' keys — it is trimmed and
 * validated separately (`inputSchema`) and passed as its own second argument.
 * If it is ever added back to the `fields` object type, remove it from here
 * or it will be handled twice: once untrimmed (via `fields.publishDate`) and
 * once trimmed (via the second argument), silently favouring whichever
 * assignment runs last.
 */
const buildChanges = (
  fields: {
    title?: string | null;
    titleSort?: string | null;
    author?: string | null;
    authorSort?: string | null;
    description?: string | null;
    publisher?: string | null;
    series?: string | null;
    seriesIndex?: number | null;
    identifiers?: readonly { scheme: string; value: string }[] | null;
    subjects?: readonly string[] | null;
  },
  publishDate: string | undefined
): EpubChanges => {
  const changes: EpubChanges = {};
  if (fields.title != null) changes.title = fields.title;
  if (fields.author != null) changes.author = fields.author;
  if (fields.titleSort != null) changes.titleSort = fields.titleSort;
  if (fields.authorSort != null) changes.authorSort = fields.authorSort;
  if (publishDate !== undefined) changes.publishDate = publishDate;
  if (fields.description != null) changes.description = fields.description;
  if (fields.publisher != null) changes.publisher = fields.publisher;
  if (fields.series != null) changes.series = fields.series;
  if (fields.seriesIndex != null) changes.seriesIndex = fields.seriesIndex;
  if (fields.identifiers != null) {
    changes.identifiers = fields.identifiers.map((i) => ({ scheme: i.scheme, value: i.value }));
  }
  if (fields.subjects != null) changes.subjects = [...fields.subjects];
  return changes;
};

/**
 * Mirrored REST's `PATCH /api/books/:id/metadata` (`routes/ui.ts`, removed in
 * `e67b4ad9`). Input is the `Book` global ID alone (design doc's 10-mutation
 * input collapse), decoded with the same `parseCompoundId`/`NO_MATCH_USER_ID`
 * convention `bookValidate` established — see that file's resolver doc comment
 * for the full malformed-id / wrong-type-id reasoning, which applies here
 * unchanged. `authScopes` runs `ownerOf` on the decoded userId, the same way
 * REST's `resolveOwner` lets a regular viewer edit only their own library and
 * an admin target any; REST's "admin without a target" 400 cannot occur here,
 * since the decoded id always names a specific owner rather than leaving one to
 * be supplied separately.
 *
 * The decoded id's malformed-local-id early return (`parsed === null`) runs
 * before the remaining fields' zod parse, matching `progressDelete`'s
 * "input parsed before owner/book resolution" order in spirit: both checks
 * are pure/local, run before any service call, and this does not leak anything
 * an attacker couldn't already learn — a malformed `publishDate` yields the
 * same `InvalidInputError` whether or not the book exists or is valid, so
 * the response is identical either way.
 *
 * Two REST preconditions run before `applyEpubChanges` is ever called, and
 * both are mirrored here as plain early returns rather than typed union
 * members of the domain-error union (they are not thrown domain errors; REST
 * checked them itself, before calling into `applyEpubChanges`):
 *
 *  - Book not found → REST 404. Mirrored as `null`, the same convention
 *    `progressDelete` established for "no such row" (see that file's doc
 *    comment) — not a typed error, since absence is not a domain failure a
 *    client acts on.
 *  - `book.valid !== true` → REST 409 ("This book must pass validation
 *    before it can be edited."). **Flagged**: the spec's error model and this
 *    task's brief do not mention this precondition at all — it was only
 *    discovered by reading the full route, per the task's escalation
 *    instruction ("mirror REST's exact behaviour and code, and flag it").
 *    Mirrored as `BookNotValidatedError` (`book-not-validated-error/model.ts`),
 *    a dedicated union member — not a reuse of `EpubValidationError` (task-2
 *    review, Adjudication 2, overturned the original reuse: it fabricated a
 *    "validation failed" message for a book that was simply never validated,
 *    and collapsed REST's 409/422 distinction into one union member a client
 *    cannot discriminate).
 *
 * `applyEpubChanges` can throw exactly two of the seven known
 * domain errors, traced from `services/apply-epub-changes.ts`: `assertValidEpub`
 * throws `EpubValidationError` when the rewritten EPUB fails validation, and
 * `reimportBook` throws `BookHashCollisionError` when the edited
 * content's new fingerprint collides with another book already in the
 * library. (`replaceEpubBytes` also has one path that throws a plain `Error`
 * — "Re-import returned no book after replace" — deliberately NOT one of the
 * seven; `toResult`'s `expected` list below does not include it, so it
 * rethrows, reaching yoga's masking as an unexpected failure, same as REST's
 * fallback 500 for anything `applyEpubChanges` throws that isn't one of its
 * two explicitly-caught classes.) `expected` is what makes that boundary
 * runtime-enforced rather than merely typed — see `to-result.ts`'s doc
 * comment.
 *
 * A successful edit rewrites the EPUB, so the book's content-hash id changes
 * (partial MD5 of the new bytes) — the returned `Book.id` decodes to the
 * *new* raw id, not the input `id`'s local part (see `test-helpers.ts`'s
 * `rawBookId`, the decode helper `update-metadata.test.ts`'s admin-edit test
 * uses to observe this). The old id's `Book` node is now dangling; a client
 * must evict it itself (Houdini phase) rather than expect it updated in
 * place. Written down here because that test is otherwise the only place
 * this behaviour is visible.
 *
 * `stagedCoverId` (Task 3b, 2026-08-01): traced end to end against REST's
 * multipart-cover branch (`routes/ui.ts`, removed in `e67b4ad9`), which merged
 * `changes.coverData`/`changes.coverMime` into the SAME `changes` object as
 * every metadata field and called `applyEpubChanges` exactly ONCE — there was
 * no REST code path where metadata and cover are written separately or one can
 * land without the other. This resolver mirrors that atomicity literally, not
 * just in spirit: when `stagedCoverId` is present, the resolved cover's
 * bytes/mime are folded into the SAME `changes` object `buildChanges` already
 * produced, and `applyEpubChanges` still runs exactly once below — a validation
 * failure or hash collision on that single write rejects metadata and cover
 * together, precisely as it always has for metadata alone (no new
 * partial-application behaviour is introduced).
 *
 * `stagedCoverId` resolution itself happens BEFORE that write, as one more
 * early return alongside the two existing REST-mirrored preconditions
 * (book-not-found, book-not-valid) above: an unknown/expired/foreign/kind-
 * mismatched id returns `StagedUploadNotFoundError` immediately, without
 * calling `applyEpubChanges` at all, so metadata is NOT applied in that case
 * either. REST has no literal precedent for this exact failure (the field is
 * new — nothing in `PATCH .../metadata` can fail this way), but the pattern
 * — reject early, touch nothing — is the same one this very resolver already
 * uses for its two REST-derived preconditions, and the one `bookReplace`
 * uses for the identical `StagedUploadNotFoundError` case on the EPUB side.
 *
 * The staged cover is resolved/consumed by `stagingIdentityOf(context.
 * viewer)` — the *authenticated caller's* staging identity — never by the
 * decoded owner of `id`. Same split `bookAnalyzeReplace`/`bookReplace` use
 * for `stagedUploadId` (see that file's doc comment): an admin session maps
 * to `ADMIN_STAGING_ID`, a bucket distinct from every real userId (Task 4),
 * so an admin CAN now stage and resolve its own cover — including applying
 * it to any user's book via `id`, the end-to-end this task exists to enable
 * — but still can never resolve a cover staged by the user the decoded id
 * names, or by any other user. `resolve`/`consume` are called with
 * `kind: 'cover'` explicitly, so a
 * `stagedUploadId` from `bookReplace`'s EPUB-staging flow is rejected here
 * exactly like an unknown id — see `replace-staging.ts`'s `StagedKind` doc
 * comment.
 *
 * Consumed on SUCCESS ONLY, matching `bookReplace`'s "consume-on-success-
 * only" rule verbatim: a typed failure (`BookHashCollisionError`,
 * `EpubValidationError`) or an input-validation failure leaves the staged
 * cover alone, so a client can retry with the same `stagedCoverId` without
 * re-uploading the image.
 *
 * Also mirrors REST's thumbnail side effect (`routes/ui.ts`, removed in
 * `e67b4ad9`, `if (req.file) thumbnailQueue.enqueue(...)`): a successful cover
 * application enqueues thumbnail regeneration for the (new, post-edit) book id,
 * the same way REST does for its own `req.file` branch — dropping this would
 * leave OPDS/UI thumbnails stale after a GraphQL-driven cover change with no
 * REST request ever having touched the book again.
 */
builder.mutationField('bookUpdateMetadata', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Updates a book’s metadata fields and, optionally, its cover via a ' +
      'previously staged upload (`stagedCoverId`). The legacy multipart ' +
      'cover branch of `PATCH /api/books/:id/metadata` still exists ' +
      'separately until the client migrates. Resolves to null when the ' +
      'book does not exist for the resolved owner.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args) => {
      const parsed = parseCompoundId(args.input.id.id);
      return { ownerOf: parsed === null ? NO_MATCH_USER_ID : parsed[0] };
    },
    resolve: async (_parent, args, context) => {
      const parsed = parseCompoundId(args.input.id.id);
      if (parsed === null) return null; // admin passed scope on a malformed id: same "no such row" convention
      const [userId, bookId] = parsed;

      const parsedInput = inputSchema.safeParse({
        publishDate: args.input.publishDate ?? undefined,
        stagedCoverId: args.input.stagedCoverId ?? undefined,
      });
      if (!parsedInput.success) return invalidInputError(parsedInput.error);

      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const targetBook = await getBookById(context.prisma, context.config.booksDir, owner, bookId);
      if (targetBook === null) return null;

      if (targetBook.valid !== true) {
        return bookNotValidatedError(owner, targetBook.id);
      }

      const changes = buildChanges(args.input, parsedInput.data.publishDate?.trim());

      const stagingIdentity = stagingIdentityOf(context.viewer!);
      if (parsedInput.data.stagedCoverId !== undefined) {
        const staged =
          stagingIdentity === null
            ? null
            : context.replaceStaging.resolve(
                parsedInput.data.stagedCoverId,
                stagingIdentity,
                'cover'
              );
        if (staged === null) return stagedUploadNotFoundError();
        changes.coverData = fs.readFileSync(staged.path);
        changes.coverMime = staged.mimeType ?? 'application/octet-stream';
      }

      const deps: ApplyEpubChangesDeps = {
        reimportBook: (o, i) =>
          reimportBook(context.prisma, context.config.booksDir, context.editionsRoot, o, i),
        prisma: context.prisma,
        validationThreshold: context.config.validationThreshold,
      };

      const outcome = await toResult<Book, BookHashCollisionError | EpubValidationError>(
        () => applyEpubChanges(deps, owner, targetBook, changes),
        [BookHashCollisionError, EpubValidationError]
      );
      if ('err' in outcome) {
        if (outcome.err instanceof BookHashCollisionError) {
          return bookHashCollisionError(outcome.err, owner);
        }
        if (outcome.err instanceof EpubValidationError) {
          return epubValidationError(outcome.err);
        }
        return assertUnreachableDomainError(outcome.err);
      }

      if (parsedInput.data.stagedCoverId !== undefined) {
        context.thumbnails.enqueue(owner.userId, outcome.ok.id);
        // stagingIdentity is non-null here — the resolve() above already
        // required it to be non-null to reach a success outcome.
        context.replaceStaging.consume(parsedInput.data.stagedCoverId, stagingIdentity!, 'cover');
      }

      return {
        __typename: 'BookUpdateMetadataPayload' as const,
        owner,
        bookId: outcome.ok.id,
      };
    },
  })
);

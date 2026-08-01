import { z } from 'zod';

import {
  applyEpubChanges,
  type ApplyEpubChangesDeps,
} from '../../../../services/apply-epub-changes';
import { BookHashCollisionError } from '../../../../services/book-store';
import { EpubValidationError } from '../../../../services/epub-validator';
import type { EpubChanges } from '../../../../services/epub-writer';
import type { Book, Owner } from '../../../../types';
import { assertUnreachableStoreError, toResult } from '../../../to-result';
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
import { model as user } from '../../user/model';
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
 * JSON metadata fields only — mirrors `PATCH /api/books/:id/metadata`
 * (`routes/ui.ts:1101`) minus its `coverUpload.single('cover')` multipart
 * field. The cover stays REST (spec's binary boundary: image bytes do not
 * belong in a GraphQL mutation), so a client editing both title/author *and*
 * the cover still issues two requests, exactly as REST itself required two
 * conceptually separate things (`multer` field vs body fields) inside one
 * route. A field here left absent (`undefined`, not sent) leaves that column
 * unchanged, the same way `body.title !== undefined` gates each REST branch —
 * see the resolver's `buildChanges` for how that distinction is preserved.
 *
 * `bookId` is the raw content-hash id (`Book.bookId`), not a `Book` global
 * ID: book ids are partial MD5s of file content, so two users can legitimately
 * hold the same one, and `Library.book(id:)` already takes the same raw string
 * for the same reason (see that field's doc comment). `userId` is the `User`
 * global ID that resolves which library owns the edit — see the resolver's
 * `authScopes` note.
 */
const input = builder.inputType('BookUpdateMetadataInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: user }),
    bookId: t.string({ required: true }),
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
 * `bookId.min(1)` is NOT a REST mirror (REST's `:id` path segment cannot be
 * empty; a matching `PATCH /api/books//metadata` would 404 at the router
 * before ever reaching this handler) — it exists for consistency with
 * `bookDelete`'s identical rule on the same field (review Minor-2): both
 * mutations now reject an empty `bookId` the same way, rather than one
 * returning `InvalidInputError` and the other silently treating it as
 * "book not found".
 */
const inputSchema = z.object({
  bookId: z.string().min(1, 'bookId must not be empty'),
  publishDate: z
    .string()
    .refine((value) => {
      const trimmed = value.trim();
      return trimmed === '' || ISO_8601_RE.test(trimmed);
    }, 'publishDate must be a valid ISO 8601 date string')
    .optional(),
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
 * lookup keyed by the owner + the post-edit id the store call reported —
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
 * Mirrors `PATCH /api/books/:id/metadata` (`routes/ui.ts:1101`). Owner
 * resolution mirrors REST's `resolveOwner`: a regular viewer always edits
 * their own library, an admin must name a target — expressed here the same
 * way `progressDelete` expresses it, as a `userId` global ID gated by the
 * `ownerOf` scope (`isOwnerOrAdmin`), rather than REST's `?user=` query
 * param. REST's "admin without `?user=`" 400 cannot occur here: `userId` is a
 * required input field, so GraphQL rejects that request before this resolver
 * (or even `authScopes`) ever runs.
 *
 * Input is parsed before owner/book resolution (matching `progressDelete`'s
 * order, not REST's — `routes/ui.ts:1113-1149` checks the 404, then the 409,
 * then `publishDate`). This does not leak anything an attacker couldn't
 * already learn: a malformed `publishDate` yields the same `InvalidInputError`
 * whether or not the book exists or is valid, so the response is identical
 * either way, and the ordering is arguably safer than REST's (a malformed
 * request never touches the store at all).
 *
 * Two REST preconditions run before `applyEpubChanges` is ever called, and
 * both are mirrored here as plain early returns rather than typed union
 * members from the store path (they are not store throws; REST checks them
 * itself, before calling into `applyEpubChanges`):
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
 * `applyEpubChanges`'s store path can throw exactly two of the seven known
 * store errors, traced from `services/apply-epub-changes.ts`: `assertValidEpub`
 * throws `EpubValidationError` when the rewritten EPUB fails validation, and
 * `BookStore.reimportBook` throws `BookHashCollisionError` when the edited
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
 * (partial MD5 of the new bytes) — the returned `Book.bookId` is the *new*
 * id, not `input.bookId`. The old id's `Book` node is now dangling; a client
 * must evict it itself (Houdini phase) rather than expect it updated in
 * place. Written down here because `update-metadata.test.ts`'s admin-edit
 * test is otherwise the only place this behaviour is visible.
 */
builder.mutationField('bookUpdateMetadata', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Updates a book’s metadata fields. Cover uploads stay on ' +
      '`PATCH /api/books/:id/metadata` (binary boundary) — this mutation ' +
      'covers the JSON fields only. Resolves to null when the book does not ' +
      'exist for the resolved owner.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args) => ({ ownerOf: args.input.userId.id }),
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({
        bookId: args.input.bookId,
        publishDate: args.input.publishDate ?? undefined,
      });
      if (!parsed.success) return invalidInputError(parsed.error);

      const userId = args.input.userId.id;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const targetBook = await context.stores.book.getBookById(owner, parsed.data.bookId);
      if (targetBook === null) return null;

      if (targetBook.valid !== true) {
        return bookNotValidatedError(owner, targetBook.id);
      }

      const changes = buildChanges(args.input, parsed.data.publishDate?.trim());

      const deps: ApplyEpubChangesDeps = {
        bookStore: context.stores.book,
        validationStore: context.stores.validation,
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
        return assertUnreachableStoreError(outcome.err);
      }

      return {
        __typename: 'BookUpdateMetadataPayload' as const,
        owner,
        bookId: outcome.ok.id,
      };
    },
  })
);

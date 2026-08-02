import { z } from 'zod';

import type { Owner } from '../../../../types';
import { builder } from '../../builder';
import {
  editLineageEntryError,
  model as editLineageEntryErrorModel,
} from '../../edit-lineage-entry-error/model';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import {
  lineageEntryNotFoundError,
  model as lineageEntryNotFoundErrorModel,
} from '../../lineage-entry-not-found-error/model';
import { NO_MATCH_USER_ID, parseCompoundId } from '../../node-scope';
import { model as bookType } from '../model';

/**
 * Mirrors `DELETE /api/books/:id/link/:documentId` (`routes/ui.ts:897`) —
 * both `bookId` and `documentId` are REST path segments there, so
 * `documentId` is not trimmed here (an empty path segment can't reach REST
 * in the first place; see `inputSchema`'s doc comment for why this mutation
 * still rejects one explicitly). The `Book` global ID IS the input's `id`
 * field — no separate `userId`/`bookId` pair. Same shape as `bookValidate`'s
 * `BookValidateInput` (see that file's doc comment for the full rationale):
 * the id's compound-key local part already carries the owner, so decoding it
 * at the resolver boundary yields both halves the old two-argument shape
 * used to require. `documentId` stays a raw string, not a `Book`-scoped or
 * global id: it names a KOReader document, which has no `Node` type of its
 * own in this schema.
 */
const input = builder.inputType('BookUnlinkDocumentInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: bookType }),
    documentId: t.string({ required: true }),
  }),
});

/**
 * `min(1)` on `documentId`, for the same reason `bookDelete`'s `bookId` used
 * to get it: REST's path segments cannot structurally be empty, so this is
 * the one input REST never had to reject — this mutation rejects it
 * explicitly instead, since GraphQL has no equivalent route-matching floor.
 * `bookId` itself has no zod rule here any more — it is no longer a plain
 * string field at all, having been absorbed into the `id` global ID's
 * compound-key local part (`InvalidInputError` for an empty `bookId` is
 * unreachable now the same way it became unreachable for `bookDelete`'s
 * identical field in task 2: an id that doesn't parse is the
 * `parsed === null` early return below, not a zod issue).
 */
const inputSchema = z.object({
  documentId: z.string().min(1, 'documentId must not be empty'),
});

type BookUnlinkDocumentPayloadShape = {
  readonly __typename: 'BookUnlinkDocumentPayload';
  readonly owner: Owner;
  readonly bookId: string;
};

/**
 * `book` is a fresh lookup — see `BookLinkDocumentPayload`'s identical note.
 * Unlinking never renames the book, so `bookId` here is always the decoded
 * `id`'s local part.
 */
const payload = builder
  .objectRef<BookUnlinkDocumentPayloadShape>('BookUnlinkDocumentPayload')
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
 * Compile-time exhaustiveness (review M-4) over `BookStore.unlinkDocument`'s
 * return type, the same `never`-narrowing idiom `assertUnreachableStoreError`
 * (`to-result.ts`) uses for the seven known store errors: the `switch` below
 * has one `case` per member of `'deleted' | 'not_found' | 'edit_row'`, so a
 * fourth discriminator added to that return type fails `outcome` to narrow to
 * `never` at the `default:` branch — a BUILD failure, not a silently-wrong
 * "success" fallthrough. Local to this file, not `to-result.ts`: this is not
 * one of the seven known store errors, and `unlinkDocument` isn't wrapped in
 * `toResult` at all (see the resolver's own doc comment for why).
 */
function assertUnreachableUnlinkOutcome(outcome: never): never {
  throw new Error(`Unreachable unlinkDocument outcome: ${String(outcome)}`);
}

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('BookUnlinkDocumentResult', {
  types: [
    payload,
    invalidInputErrorModel,
    lineageEntryNotFoundErrorModel,
    editLineageEntryErrorModel,
  ],
});

/**
 * Mirrors `DELETE /api/books/:id/link/:documentId` (`routes/ui.ts:897-914`).
 * Input is the `Book` global ID alone plus `documentId` (design doc's
 * 10-mutation input collapse), decoded with the same
 * `parseCompoundId`/`NO_MATCH_USER_ID` convention `bookValidate` established
 * — see that file's resolver doc comment for the full malformed-id /
 * wrong-type-id reasoning, which applies here unchanged. `authScopes` runs
 * `ownerOf` on the decoded userId, the same way REST's `resolveOwner` lets a
 * regular viewer act only on their own library and an admin target any.
 *
 * `BookStore.unlinkDocument` is NOT wrapped in `toResult`: traced end to end
 * (`book-store.ts:616-637`), it never throws any of the seven known store
 * errors — it returns a plain `'deleted' | 'not_found' | 'edit_row'`
 * discriminator instead, which this resolver maps directly onto the result
 * union (`LineageEntryNotFoundError` / `EditLineageEntryError` — see those
 * files' doc comments for why they exist as honest, REST-mirrored members
 * rather than a reused error or a collapsed `null`). Wrapping a call that
 * raises none of the seven would make `toResult`'s `err` branch
 * undischargeable — see `to-result.ts`'s doc comment.
 *
 * REST's route itself has no separate book-existence check ahead of the
 * `unlinkDocument` call (traced: `routes/ui.ts:897-914` goes straight from
 * `resolveOwner` to `bookStore.unlinkDocument`), so this resolver doesn't add
 * one either — an unknown `bookId` simply yields no matching lineage row,
 * i.e. `'not_found'`, exactly like REST's own behaviour.
 */
builder.mutationField('bookUnlinkDocument', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Removes a manually-linked (merge) lineage entry from a book. Fails ' +
      'with LineageEntryNotFoundError when no such entry exists, and with ' +
      'EditLineageEntryError for an organic edit-history entry, which cannot ' +
      'be unlinked this way.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args) => {
      const parsed = parseCompoundId(args.input.id.id);
      return { ownerOf: parsed === null ? NO_MATCH_USER_ID : parsed[0] };
    },
    resolve: async (_parent, args, context) => {
      const parsed = parseCompoundId(args.input.id.id);
      if (parsed === null) return null; // admin passed scope on a malformed id: same "no such row" convention
      const [userId, bookId] = parsed;

      const parsedInput = inputSchema.safeParse({ documentId: args.input.documentId });
      if (!parsedInput.success) return invalidInputError(parsedInput.error);

      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const outcome = await context.stores.book.unlinkDocument(
        owner,
        bookId,
        parsedInput.data.documentId
      );
      switch (outcome) {
        case 'not_found':
          return lineageEntryNotFoundError();
        case 'edit_row':
          return editLineageEntryError();
        case 'deleted':
          return {
            __typename: 'BookUnlinkDocumentPayload' as const,
            owner,
            bookId,
          };
        default:
          return assertUnreachableUnlinkOutcome(outcome);
      }
    },
  })
);

import type { Owner } from '../../../../types';
import { builder } from '../../builder';
import { NO_MATCH_USER_ID, parseCompoundId } from '../../node-scope';
import { model as book } from '../model';

/**
 * The `Book` global ID IS the input — no separate `userId`/`bookId` pair.
 * Same shape as `bookValidate`'s `BookValidateInput` (see that file's doc
 * comment for the full rationale): the id's compound-key local part already
 * carries the owner, so decoding it at the resolver boundary yields both
 * halves the old two-argument shape used to require.
 */
const input = builder.inputType('BookClearEditLineageInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: book }),
  }),
});

type BookClearEditLineagePayloadShape = {
  readonly __typename: 'BookClearEditLineagePayload';
  readonly owner: Owner;
  readonly bookId: string;
  readonly clearedCount: number;
};

/**
 * `book` is a fresh lookup, not a store-returned DTO — same reasoning as
 * `BookClearEditionsPayload.book`. Clearing edit lineage never renames the
 * book.
 */
const payload = builder
  .objectRef<BookClearEditLineagePayloadShape>('BookClearEditLineagePayload')
  .implement({
    fields: (t) => ({
      clearedCount: t.exposeInt('clearedCount'),
      book: t.prismaField({
        type: book,
        resolve: (query, parent, _args, context) =>
          context.prisma.book.findUniqueOrThrow({
            ...query,
            where: { userId_id: { userId: parent.owner.userId, id: parent.bookId } },
          }),
      }),
    }),
  });

/**
 * Single-member union, not a bare payload type: additive-safe if a future
 * error case needs a member (spec 1's single-member-union precedent), same
 * as `BookClearEditionsResult`. No `InvalidInputError` member — this
 * mutation's only input, the `Book` global ID, is validated entirely by the
 * relay arg layer (malformed/wrong-type rejection happens before the
 * resolver runs, exactly like `bookValidate`/`bookClearEditions` — see
 * `clear-editions.ts`'s identical note); there is no zod schema left in this
 * file to make that member reachable, so the traced-union-drop rule (design
 * doc's "Discovered consequence") requires dropping it.
 *
 * No `resolveType`: the one member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('BookClearEditLineageResult', {
  types: [payload],
});

/**
 * Mirrors `DELETE /api/books/:id/lineage` (`routes/ui.ts:1096-1111`). Owner
 * resolution mirrors REST's `resolveOwner` — see `bookUpdateMetadata`'s doc
 * comment.
 *
 * Input is the `Book` global ID alone (design doc's 10-mutation input
 * collapse), decoded with the same `parseCompoundId`/`NO_MATCH_USER_ID`
 * convention `bookValidate` established — see that file's resolver doc
 * comment for the full malformed-id / wrong-type-id reasoning, which applies
 * here unchanged.
 *
 * IMPORTANT — this clears ONLY `type = 'edit'` rows in `book_id_history`:
 * the organic re-import history `reimportBook` writes. `type = 'merge'` rows
 * — the manual KOReader document links `bookLinkDocument`/`bookUnlinkDocument`
 * write and remove — are a DISJOINT row set and are left untouched by this
 * mutation (`BookStore.clearEditLineage`, `book-store.ts:646-653`). This is
 * therefore NOT a bulk form of `bookUnlinkDocument` — the two operate on rows
 * that never overlap. The wordier name (`bookClearEditLineage`, not
 * `bookClearLineage`) exists precisely so the mutation cannot be mistaken for
 * clearing lineage in general when it only ever clears the edit half of it.
 *
 * `BookStore.clearEditLineage` is NOT wrapped in `toResult`: traced end to
 * end (`book-store.ts:646-653`), it is a single raw `$executeRaw` DELETE and
 * throws none of the seven known store errors. Wrapping it would make
 * `toResult`'s `err` branch undischargeable — see `to-result.ts`'s doc
 * comment, and `bookClearEditions`'s identical note for `clearDeviceEditions`.
 *
 * Unlike `clearDeviceEditions` (`Promise<number | null>`), `clearEditLineage`
 * returns a plain `Promise<number>` — a raw `$executeRaw` DELETE reports 0
 * rows affected for a nonexistent book exactly as it does for a book with no
 * edit-lineage rows, so the store itself cannot distinguish "not found" from
 * "nothing to clear". The resolver therefore checks existence explicitly with
 * `getBookById` before calling the store, mirroring REST's own two-step
 * `getBookById` → `clearEditLineage` (`routes/ui.ts:1102-1108`) rather than
 * inferring not-found from a zero count, which would wrongly turn "book
 * exists, zero edit rows" into `null` too.
 */
builder.mutationField('bookClearEditLineage', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Clears a book’s organic edit-lineage history (the ids it has held ' +
      'across re-imports). Manually-linked KOReader document ids (type ' +
      '"merge") are a disjoint row set and are left untouched. Resolves to ' +
      'null when the book does not exist for the resolved owner.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: (_parent, args) => {
      const parsed = parseCompoundId(args.input.id.id);
      return { ownerOf: parsed === null ? NO_MATCH_USER_ID : parsed[0] };
    },
    resolve: async (_parent, args, context) => {
      const parsed = parseCompoundId(args.input.id.id);
      if (parsed === null) return null; // admin passed scope on a malformed id: same "no such row" convention
      const [userId, bookId] = parsed;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const existing = await context.stores.book.getBookById(owner, bookId);
      if (existing === null) return null;

      const cleared = await context.stores.book.clearEditLineage(owner, bookId);

      return {
        __typename: 'BookClearEditLineagePayload' as const,
        owner,
        bookId,
        clearedCount: cleared,
      };
    },
  })
);

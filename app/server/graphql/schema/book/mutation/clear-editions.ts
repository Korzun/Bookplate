import { clearDeviceEditions } from '../../../../services/book-lifecycle';
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
const input = builder.inputType('BookClearEditionsInput', {
  fields: (t) => ({
    id: t.globalID({ required: true, for: book }),
  }),
});

type BookClearEditionsPayloadShape = {
  readonly __typename: 'BookClearEditionsPayload';
  readonly owner: Owner;
  readonly bookId: string;
  readonly clearedCount: number;
};

/**
 * `book` is a fresh lookup, not a store-returned DTO — same reasoning as
 * `BookLinkDocumentPayload.book`. Clearing editions never renames the book.
 */
const payload = builder
  .objectRef<BookClearEditionsPayloadShape>('BookClearEditionsPayload')
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
 * error case needs a member (spec 1's single-member-union precedent). No
 * `InvalidInputError` member — this mutation's only input, the `Book` global
 * ID, is validated entirely by the relay arg layer (malformed/wrong-type
 * rejection happens before the resolver runs, exactly like `bookValidate` —
 * see that file's field doc comment); there is no zod schema left in this
 * file to make that member reachable, so the traced-union-drop rule (design
 * doc's "Discovered consequence") requires dropping it.
 *
 * No `resolveType`: the one member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('BookClearEditionsResult', {
  types: [payload],
});

/**
 * Mirrors `DELETE /api/books/:id/editions` (`routes/ui.ts:1039-1054`). Owner
 * resolution mirrors REST's `resolveOwner` — see `bookUpdateMetadata`'s doc
 * comment.
 *
 * Input is the `Book` global ID alone (design doc's 10-mutation input
 * collapse), decoded with the same `parseCompoundId`/`NO_MATCH_USER_ID`
 * convention `bookValidate` established — see that file's resolver doc
 * comment for the full malformed-id / wrong-type-id reasoning, which applies
 * here unchanged.
 *
 * `clearDeviceEditions` (`services/book-lifecycle.ts`) is NOT wrapped in
 * `toResult`: traced end to end, it only ever calls `getBookById`
 * (`services/book-catalog.ts` — a plain read) and `purgeForBook`
 * (`services/edition.ts`) — neither throws any of the seven known domain
 * errors. Wrapping it would make `toResult`'s `err` branch undischargeable —
 * see `to-result.ts`'s doc comment, and `bookDelete`'s identical note for
 * `deleteBook`.
 *
 * REST 404 (book not found) is modelled as `null`, the same "no such row"
 * convention every other book mutation in this schema uses —
 * `clearDeviceEditions` itself returns `null` for that case
 * (`Promise<number | null>`), so the resolver just forwards it.
 */
builder.mutationField('bookClearEditions', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Clears every cached per-device edition of a book (DB rows and on-disk ' +
      'files); they regenerate lazily on next download. Resolves to null when ' +
      'the book does not exist for the resolved owner.',
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

      const cleared = await clearDeviceEditions(
        context.prisma,
        context.config.booksDir,
        context.editionsRoot,
        owner,
        bookId
      );
      if (cleared === null) return null;

      return {
        __typename: 'BookClearEditionsPayload' as const,
        owner,
        bookId,
        clearedCount: cleared,
      };
    },
  })
);

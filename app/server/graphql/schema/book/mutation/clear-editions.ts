import { z } from 'zod';

import type { Owner } from '../../../../types';
import { builder } from '../../builder';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as user } from '../../user/model';
import { model as bookType } from '../model';

/**
 * `bookId` is the raw content-hash id. `userId` follows the same
 * `ownerOf`-scoped shape every other book mutation in this file uses (see
 * `bookUpdateMetadata`'s doc comment) — REST's own route
 * (`DELETE /api/books/:id/editions`) has no equivalent, since it resolves
 * the owner from `?user=`/session instead.
 */
const input = builder.inputType('BookClearEditionsInput', {
  fields: (t) => ({
    userId: t.globalID({ required: true, for: user }),
    bookId: t.string({ required: true }),
  }),
});

/**
 * `min(1)` mirrors `bookDelete`/`bookUpdateMetadata`'s identical rule — see
 * those files' doc comments.
 */
const inputSchema = z.object({
  bookId: z.string().min(1, 'bookId must not be empty'),
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
const result = builder.unionType('BookClearEditionsResult', {
  types: [payload, invalidInputErrorModel],
});

/**
 * Mirrors `DELETE /api/books/:id/editions` (`routes/ui.ts:1039-1054`). Owner
 * resolution mirrors REST's `resolveOwner` — see `bookUpdateMetadata`'s doc
 * comment.
 *
 * `BookStore.clearDeviceEditions` is NOT wrapped in `toResult`: traced end to
 * end (`book-store.ts:776-784`), it only ever calls `getBookById` (a plain
 * read) and `EditionPurger.purgeForBook` — neither throws any of the seven
 * known store errors. Wrapping it would make `toResult`'s `err` branch
 * undischargeable — see `to-result.ts`'s doc comment, and `bookDelete`'s
 * identical note for `deleteBook`.
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
    authScopes: (_parent, args) => ({ ownerOf: args.input.userId.id }),
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({ bookId: args.input.bookId });
      if (!parsed.success) return invalidInputError(parsed.error);

      const userId = args.input.userId.id;
      const owner = await context.loadOwner(userId);
      if (owner === null) return null;

      const cleared = await context.stores.book.clearDeviceEditions(owner, parsed.data.bookId);
      if (cleared === null) return null;

      return {
        __typename: 'BookClearEditionsPayload' as const,
        owner,
        bookId: parsed.data.bookId,
        clearedCount: cleared,
      };
    },
  })
);

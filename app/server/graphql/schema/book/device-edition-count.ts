import { builder } from '../builder';
import { model } from './model';

/**
 * How many per-device converted editions of this book are cached for its
 * owner. `GET /api/books/:id` (`routes/ui.ts`) asks `getBookById` for it via
 * `{ withEditionCount: true }`, and `getBookById` in turn calls exactly this
 * store method with exactly these two arguments (`book-store.ts`:
 * `book.deviceEditionCount = await this.editionStore.countForBook(owner.userId, id)`),
 * so this is the same number REST reports, from the same query.
 *
 * Both arguments come off the parent row — `parent.userId` is the book's own
 * owner, never re-derived from the viewer — so the count is owner-scoped by
 * construction, in the same sense `Book.progress` is.
 *
 * Placed here rather than in a `device-edition/` directory (the convention
 * being that a field on a foreign type lives in its *value* type's directory)
 * for the same reason `lineage.ts` sits in `book/`: the value is a plain
 * `Int`, and `DeviceEdition` is exposed as no GraphQL type at all, so there is
 * no directory for it to belong to. A whole entity directory for one scalar
 * field would be overhead, not structure.
 *
 * `builder.objectField`, not `prismaObjectField`: this resolves through a
 * store, not a Prisma relation — `DeviceEdition` has no relation to `Book` in
 * `schema.prisma` (it is keyed `[userId, originalBookId, deviceId]` with no
 * foreign key), so `t.relationCount` cannot express it.
 */
builder.objectField(model, 'deviceEditionCount', (t) =>
  t.int({
    resolve: (book, _args, context) => context.stores.edition.countForBook(book.userId, book.id),
  })
);

import type { PendingFixDto } from '../../../services/book-store';
import * as book from '../book';
import { builder } from '../builder';

/**
 * The DTO plus the owner it was read for. `getPendingFixes` returns rows with
 * no `userId` (see the type comment below), but `PendingFixSummary.book` needs
 * one to look the book up — and a resolver only ever receives its own parent,
 * never the `Library` above it. So `Library.pendingFixes` attaches the owner
 * it already holds, building new objects rather than mutating the store's.
 */
type PendingFixSummaryRow = PendingFixDto & { userId: string };

/**
 * `Library.pendingFixes` cannot reuse the `PendingFix` prismaObject from
 * `../pending-fix/model`: that type's `Shape` is pinned to the real
 * `PendingFix` Prisma row (`userId`, `state`, `createdAt`, `updatedAt`
 * included), but `context.stores.book.getPendingFixes` deliberately returns a
 * different, already-shaped DTO — the one both REST (`GET
 * /api/books/pending-fixes`, `routes/ui.ts`) and the client
 * (`app/client/src/provider/upload/api.ts`'s `PendingFixDto`) already agree
 * on. Reusing the raw-row type here would mean either lying to TypeScript
 * about the resolver's return shape or reimplementing `getPendingFixes`'s
 * TTL/malformed-row cleanup with a direct Prisma query — both worse than a
 * second, small, DTO-shaped type.
 *
 * `state` is reconstructed here (rather than left off) so a client can
 * `JSON.parse` this `state` exactly like `PendingFix.state` (see
 * `../pending-fix/model.ts`) and land on the identical `PendingFixState`
 * shape either way — the two readings agree on content, they just can't
 * share a GraphQL type given the DTO's structural difference from the raw
 * row.
 */
export const model = builder.objectRef<PendingFixSummaryRow>('PendingFixSummary').implement({
  fields: (t) => ({
    bookId: t.exposeString('bookId'),
    fileName: t.exposeString('fileName'),
    fileSize: t.exposeInt('fileSize'),
    state: t.string({
      resolve: (pendingFix) =>
        JSON.stringify({
          autoFixes: pendingFix.autoFixes,
          appliedFixes: pendingFix.appliedFixes,
          proposals: pendingFix.proposals,
          undo: pendingFix.undo,
        }),
    }),

    /**
     * The book this fix belongs to, so `Library.pendingFixes` is navigable —
     * rendering "a pending fix on *Dune*" no longer needs a second round trip
     * keyed on `bookId`.
     *
     * Non-null: `PendingFix` has a foreign key onto `Book` with
     * `onDelete: Cascade` (`prisma/schema.prisma`), so a fix whose book is
     * gone cannot exist. `findUniqueOrThrow` matches that — if the invariant
     * ever breaks, it surfaces rather than silently nulling.
     *
     * Registered here rather than in `book/` (the convention being that a
     * field lives in its value type's directory) because the
     * `PendingFixSummary` ref is local to this type — the two-type split this
     * file's comment explains means there is nothing for `book/` to import.
     * The same judgement `Book.lineage` made: avoiding a defect, not
     * fragmenting for its own sake.
     */
    book: t.field({
      type: book.model,
      resolve: (pendingFix, _args, context) =>
        context.prisma.book.findUniqueOrThrow({
          where: { userId_id: { userId: pendingFix.userId, id: pendingFix.bookId } },
        }),
    }),
  }),
});

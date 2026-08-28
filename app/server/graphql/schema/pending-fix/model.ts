import { encodeGlobalID } from '@pothos/plugin-relay';

import { epochToDate, parsePendingFixState } from '../../derive';
import { builder } from '../builder';
import { model as pendingFixState } from '../pending-fix-state';

/**
 * Deliberately a prismaObject, not a prismaNode, following `Validation`'s and
 * `Progress`'s precedent: `PendingFix` is only ever reached through a `Book`
 * or a `Library` that are already owner-scoped, so a global ID would add a
 * second, separately-guarded door onto tenant-owned data for no client
 * benefit.
 *
 * `state` resolves the stored JSON string through `parsePendingFixState`
 * (`derive.ts`) into the typed `PendingFixState` object graph — see the
 * cleanup spec, §"2. Typed PendingFixState". That parser is the only reader
 * of the column, so there is no second interpretation to drift from.
 *
 * The formerly-separate `PendingFixSummary` type is merged in here (cleanup
 * spec, §"3. One PendingFix type"): `Library.pendingFixes` now resolves this
 * same `prismaObject`, filtered by the shared `isLivePendingFix` predicate at
 * the call site (`library/model.ts`) rather than by consuming a hand-shaped
 * DTO. The merge brought the summary's `book` field over — now a plain Prisma
 * relation, since this type is pinned to the real row (the summary's own
 * `userId`/`bookId`-keyed `findUniqueOrThrow` is no longer needed for that
 * reason).
 */
export const model = builder.prismaObject('PendingFix', {
  fields: (t) => ({
    /**
     * Byte-identical to the owning `Book`'s global id — `encodeGlobalID(
     * 'Book', JSON.stringify([userId, bookId]))`, the exact construction
     * `BookDeletePayload.deletedId` uses (`book/mutation/delete.ts`).
     * Deliberately NOT a `Book`-typed global id of `PendingFix`'s own (it
     * still has no `Node` registration — see this type's doc comment above),
     * just a plain `ID!` scalar a normalizing cache can key on: a
     * `PendingFix` is 1:1 with its book, so reusing the book's own id as this
     * type's cache key means a client's `bookResolvePendingFix` response
     * normalizes into the exact same cache entry the sibling `Book.id`
     * selection already occupies — no separate identity to reconcile.
     *
     * `pendingFix.userId`/`.bookId` are read straight off this row (the
     * compound `@@id([userId, bookId])`, `prisma/schema.prisma`), never off
     * `context.viewer` — the row's owner and the requesting viewer differ for
     * every admin-traversal read (`Query.user(id:).library.pendingFixes`),
     * exactly the case `Book.progress`'s doc comment (`progress/model.ts`)
     * warns the same class of bug against.
     */
    id: t.field({
      type: 'ID',
      resolve: (pendingFix) =>
        encodeGlobalID('Book', JSON.stringify([pendingFix.userId, pendingFix.bookId])),
    }),
    fileName: t.exposeString('fileName'),
    fileSize: t.exposeInt('fileSize'),
    state: t.field({
      type: pendingFixState,
      resolve: (pendingFix) => parsePendingFixState(pendingFix.state),
    }),
    createdAt: t.field({
      type: 'DateTime',
      resolve: (pendingFix) => epochToDate(pendingFix.createdAt),
    }),
    updatedAt: t.field({
      type: 'DateTime',
      resolve: (pendingFix) => epochToDate(pendingFix.updatedAt),
    }),

    /**
     * The book this fix belongs to, so `Library.pendingFixes` is navigable —
     * rendering "a pending fix on *Dune*" no longer needs a second round
     * trip keyed on `bookId`.
     *
     * `t.relation`, not a manual lookup: `PendingFix` has a real Prisma `book`
     * relation (`prisma/schema.prisma`, FK `onDelete: Cascade`), unlike the
     * deleted `PendingFixSummary`, which was pinned to a DTO with no relation
     * for the plugin to traverse and had to look the book up by hand via the
     * `userId`/`bookId` pair it carried. Non-null for the same reason the
     * summary's was: the cascade means a fix whose book is gone cannot exist.
     */
    book: t.relation('book'),
  }),
});

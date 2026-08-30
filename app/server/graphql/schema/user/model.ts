import type { Context } from '../../context';
import { model as bookRequest, requestKeyset } from '../book-request/model';
import { builder } from '../builder';
// `../library/model`, not `../library`: `library/index.ts` now also
// side-effect-imports `library/mutation/scan.ts` (task 8), which itself
// imports this file (`../../user/model`) for `libraryScan`'s `userId` input
// field — importing the index here instead would close that into a real
// require cycle (`user/model.ts` -> `library/index.ts` -> `library/mutation/
// scan.ts` -> `user/model.ts`). Same rule task 2 already applied to six other
// spots — see `book-hash-collision-error/model.ts`'s identical note.
import { model as library } from '../library/model';
import { isOwnerOrAdmin, NO_MATCH_USER_ID } from '../node-scope';
import { CONNECTION_LIMITS, rejectOversizePage } from '../pagination';

// `Query.node(id:)` is a second door into every registered `Node` type, and it
// bypasses `Query.user`'s `admin` scope entirely — that scope only guards the
// `user` root field, not the type itself. Without a guard here, any
// authenticated non-admin viewer could read another user's `username` and
// `mustChangePassword` straight through `node(id: <their global id>)`. So
// `User` carries the same kind of node-level guard every other node type
// does: admin or self, using the same `NO_MATCH_USER_ID` sentinel
// `ownerScopedFindUnique` uses, because `User`'s key is a plain `id` that
// already *is* the userId — the sentinel slots in directly.
//
// `passwordHash` and `syncPassword` are deliberately absent here — password
// sync is exposed on `Viewer` only, for the viewer's own account.
export const model = builder.prismaNode('User', {
  id: { field: 'id' },
  findUnique: (id: string, context: Context) => {
    const allowed = isOwnerOrAdmin(context.viewer, id);
    return { id: allowed ? id : NO_MATCH_USER_ID };
  },
  nullable: true,
  fields: (t) => ({
    username: t.exposeString('username'),
    mustChangePassword: t.exposeBoolean('mustChangePassword'),

    // The "N books synced" figure the admin user list renders
    // (`app/client/src/component/user-row/index.tsx`), and the second half of
    // what REST's `GET /api/users` used to return, before Phase 0 removed it.
    //
    // `UserStore.listUsers()` used to produce it as `_count.progresses` on a
    // `prisma.user.findMany`, before this phase dissolved `UserStore` and
    // inlined that lookup at its one call site (`viewer/model.ts`'s `users`
    // field, now a direct `context.prisma.user.findMany`).
    // `t.relationCount` compiles to that exact same `_count` select, merged
    // into whichever query already fetched this row, rather than a per-user
    // `progress.count()` — so `Viewer.users` stays one query however many
    // users exist. Deliberately NOT resolved from `listUsers()`'s old
    // `{ username, progressCount }` DTO: that DTO carried no `id`, so it
    // could not back a `User` node (no global ID, no `library`, no
    // `mustChangePassword`). Same count, same source column, kept on the
    // Prisma row this type is pinned to.
    progressCount: t.relationCount('progresses'),

    // `ownerOf`'s denial branch has no reachable case today: `Query.user` is
    // admin-gated and `Query.node` for `User` is `isOwnerOrAdmin`-gated, so the
    // only `User` object a non-admin viewer can ever hold here is their own.
    // This scope is defense-in-depth, not dead code — it becomes load-bearing
    // the moment a non-admin-reachable path to another user's `User` object
    // exists.
    library: t.field({
      type: library,
      authScopes: (parent) => ({ ownerOf: parent.id }),
      resolve: (parent) => ({ userId: parent.id, username: parent.username }),
    }),

    /**
     * This reader's book requests, newest first — the ONE field behind both
     * surfaces. The reader reaches it as `viewer { user { bookRequests } }`
     * (`Viewer.user` is already null for the config admin, which has no `User`
     * row and cannot be a requester) and the admin as
     * `user(id:) { bookRequests }` (`Query.user` is admin-gated). A separate
     * `Viewer.bookRequests` would duplicate this field, its `CONNECTION_LIMITS`
     * entry and its auth tests for no gain.
     *
     * `ownerOf` on the PARENT's id, exactly like `library` below it — ownership
     * is decided once, from the row this type is pinned to, never from
     * `context.viewer`: an admin reading `user(id:).bookRequests` must page the
     * target user's rows, not their own.
     *
     * `t.prismaConnection`, not `t.relatedConnection`, and the `resolve` drops
     * the plugin's `cursor`/`skip` — see `requestKeyset` for why. A
     * `t.relatedConnection` could not carry that fix: its `resolve` is a
     * FALLBACK ONLY, because on the normal path its rows arrive through the
     * parent's merged `select`.
     */
    bookRequests: t.prismaConnection(
      {
        type: bookRequest,
        description:
          'Books this reader has asked the library admin for, newest first. ' +
          'Paginates in both directions.',
        authScopes: (parent) => ({ ownerOf: parent.id }),
        cursor: 'userId_createdAt_id',
        // Native maxSize/defaultSize bound the Prisma query itself, but by
        // CLAMPING rather than rejecting, which pagination.ts's "reject, never
        // clamp" ruling forbids. Kept as defense in depth on the SQL; the
        // actual reject is in `resolve`.
        maxSize: CONNECTION_LIMITS.userBookRequests.maxSize,
        defaultSize: CONNECTION_LIMITS.userBookRequests.defaultSize,
        resolve: (query, parent, args, context) => {
          rejectOversizePage('User.bookRequests', args, CONNECTION_LIMITS.userBookRequests.maxSize);
          // `cursor` and `skip` are DELIBERATELY DROPPED and `take` is
          // deliberately kept — `resolvePrismaCursorConnection` slices the
          // extra row off using its OWN copy of `take`, so changing it here
          // corrupts `hasNextPage` rather than resizing the page.
          const { cursor, skip: _skip, ...page } = query;
          return context.prisma.bookRequest.findMany({
            ...page,
            where: {
              userId: parent.id,
              ...requestKeyset(cursor?.userId_createdAt_id, page.take),
            },
            // `id asc` is the tiebreaker and is required: `createdAt` is whole
            // seconds scaled by 1000, so two requests made in the same second
            // share one, and cursor pagination needs a total order.
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          });
        },
      },
      { name: 'UserBookRequestsConnection' },
      { name: 'UserBookRequestsConnectionEdge' }
    ),
  }),
});

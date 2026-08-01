import type { Context } from '../../context';
import { builder } from '../builder';
import * as library from '../library';
import { isOwnerOrAdmin, NO_MATCH_USER_ID } from '../node-scope';

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
    // what `GET /api/users` returns.
    //
    // `UserStore.listUsers()` produces it as `_count.progresses` on a
    // `prisma.user.findMany`. `t.relationCount` compiles to that exact same
    // `_count` select, merged into whichever query already fetched this row,
    // rather than a per-user `progress.count()` — so `Viewer.users` stays one
    // query however many users exist. Deliberately NOT resolved from
    // `listUsers()`'s `{ username, progressCount }` DTO: that DTO carries no
    // `id`, so it cannot back a `User` node (no global ID, no `library`, no
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
      type: library.model,
      authScopes: (parent) => ({ ownerOf: parent.id }),
      resolve: (parent) => ({ userId: parent.id, username: parent.username }),
    }),
  }),
});

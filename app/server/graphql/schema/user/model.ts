import type { Context } from '../../context';
import { builder } from '../builder';
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
  }),
});

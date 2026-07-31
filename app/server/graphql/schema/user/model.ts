import { builder } from '../builder';

// `User` has a simple `@id` rather than a compound key, and the id *is* the
// tenant boundary — a `User` global ID contains only that user's own id, so
// there is nothing to cross-tenant. Unlike `Book`/`Series` and every other
// tenant-owned node type, it deliberately does NOT go through
// `ownerScopedFindUnique`. Reaching a `User` is instead gated by the `admin`
// scope on `Query.user` (and later `Viewer.users`).
//
// `passwordHash` and `syncPassword` are deliberately absent here — password
// sync is exposed on `Viewer` only, for the viewer's own account.
export const model = builder.prismaNode('User', {
  id: { field: 'id' },
  fields: (t) => ({
    username: t.exposeString('username'),
    mustChangePassword: t.exposeBoolean('mustChangePassword'),
  }),
});

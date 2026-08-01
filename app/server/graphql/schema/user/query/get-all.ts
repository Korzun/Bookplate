import { builder } from '../../builder';
import { model as viewer } from '../../viewer';
import { model } from '../index';

/**
 * Mirrors `GET /api/users` (`routes/users.ts`). That whole router applies
 * `router.use(adminAuth)` before any handler, so the list is admin-only —
 * verified against the router itself, not assumed, and it agrees with the
 * design spec's annotation (`users: [User!]! # admin-only scope`). Contrast
 * `Viewer.devices`, whose REST equivalent is deliberately *not* admin-gated.
 *
 * `orderBy: { username: 'asc' }` is `UserStore.listUsers()`'s own ordering.
 * Read through `context.prisma` rather than the store because `listUsers()`
 * returns a `{ username, progressCount }` DTO with no `id` — it cannot back a
 * `User` node. `User.progressCount` (see `../model.ts`) exposes the same
 * `_count.progresses` the DTO carried, so nothing from the REST payload is
 * lost.
 */
builder.objectField(viewer, 'users', (t) =>
  t.prismaField({
    type: [model],
    authScopes: { admin: true },
    resolve: (query, _viewer, _args, context) =>
      context.prisma.user.findMany({ ...query, orderBy: { username: 'asc' } }),
  })
);

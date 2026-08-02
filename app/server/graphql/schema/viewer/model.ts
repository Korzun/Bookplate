import type { Viewer } from '../../context';
import { builder } from '../builder';
import { model as device } from '../device/model';
import { model as library } from '../library/model';
import { model as user } from '../user/model';

export const model = builder.objectRef<Viewer>('Viewer').implement({
  fields: (t) => ({
    username: t.exposeString('username'),
    isAdmin: t.exposeBoolean('isAdmin'),
    mustChangePassword: t.exposeBoolean('mustChangePassword'),

    library: t.field({
      type: library,
      nullable: true,
      // Null for the config-based admin, which has no user row and owns no library.
      resolve: (v, _args, context) => (v.userId === null ? null : context.loadOwner(v.userId)),
    }),

    /**
     * The viewer's own `User` row — the bridge from the root singleton `Viewer`
     * (which is not a `Node`, and has no global ID) to a normalizable `User`
     * node, so Houdini can share one cached `User` between `viewer { user }` and
     * `users`/`node(id:)`.
     *
     * Null for the config-based admin, which has no row in the users table —
     * `RefreshToken.userId` is nullable precisely for it. Same null condition and
     * same reasoning as `Viewer.library` above.
     *
     * No scope beyond the builder default: this is by construction the viewer's
     * own row, exactly as `Viewer.library` is by construction the viewer's own
     * library. There is no id argument to check.
     */
    user: t.prismaField({
      type: user,
      nullable: true,
      resolve: (query, v, _args, context) =>
        v.userId === null
          ? null
          : context.prisma.user.findUnique({ ...query, where: { id: v.userId } }),
    }),

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
     * `User` node. `User.progressCount` (see `user/model.ts`) exposes the same
     * `_count.progresses` the DTO carried, so nothing from the REST payload is
     * lost.
     *
     * `nullable: true` (pre-client hardening spec, §4 "Nullability ruling"):
     * a scope denial on a NON-nullable list here would null-propagate all
     * the way up through `Viewer` (also non-null — `query/current.ts`) to
     * the whole operation, discarding every other field the same request
     * asked for. Apollo's default `errorPolicy` ("none") already drops the
     * whole response on ANY error, but the client migration's own errorLink
     * plan (content-negotiation contract, yoga.ts) distinguishes
     * auth-shaped failures from data-shaped ones — a denial should read as
     * "this one field is inaccessible", not "the request failed".
     */
    users: t.prismaField({
      type: [user],
      nullable: true,
      authScopes: { admin: true },
      resolve: (query, _viewer, _args, context) =>
        context.prisma.user.findMany({ ...query, orderBy: { username: 'asc' } }),
    }),

    /**
     * Mirrors `GET /api/my/sync-password` (`routes/ui.ts`): `requireAuth`, then
     * `403` for an admin session, then `userStore.getSyncPassword(username)` for
     * the requesting user's *own* account — there is no route, and no field here,
     * that reads another user's sync password.
     *
     * This is `User.syncPassword` the column, read through `UserStore`, but it
     * hangs off `Viewer`, not `User`: `user/model.ts`'s own comment records that
     * `passwordHash`/`syncPassword` are deliberately absent from the `User` node
     * and exposed on `Viewer` only. This field is the "only".
     *
     * REST's `403` for an admin becomes `null` rather than a `FORBIDDEN` error:
     * the field is a property of a viewer that has a user row, and the
     * config-based admin has none (its `viewer.userId` is null), exactly like
     * `Viewer.library`. Erroring would make `{ viewer { username syncPassword } }`
     * fail wholesale for an admin instead of answering the parts that apply.
     * `isAdmin` is the condition REST branches on and is what is reproduced here;
     * for this codebase it coincides with `userId === null`, since admin status
     * comes only from the config-based account, which has no row.
     *
     * NOTE — this read has a write side effect, inherited from
     * `UserStore.getSyncPassword`: a user whose `sync_password` column is still
     * null gets one generated and persisted on first read. That is REST's
     * behaviour today (the KOSync credential is created lazily on first view), and
     * reproducing it is the point — a GraphQL client and the REST client must not
     * disagree about whether a user has a sync password.
     */
    syncPassword: t.string({
      nullable: true,
      resolve: (v, _args, context) =>
        v.isAdmin ? null : context.stores.user.getSyncPassword(v.username),
    }),

    /**
     * Matches `routes/devices.ts`'s `GET /` exactly (see its handler and its own
     * comment: "Listing devices is open to any user ... creating, editing, and
     * deleting devices stay admin-only"). Every GraphQL field already requires an
     * authenticated viewer (the builder's default `authenticated` scope), so the
     * REST route's outer `requireAuth` is already covered — the branching below
     * reproduces the REST handler's OWN branching, not a tightened or loosened
     * version of it:
     *   - an admin sees every device;
     *   - a regular user sees only the devices they are enabled on;
     *   - a viewer with no userId (defensive; only the config-based admin has a
     *     null userId, and that case is already handled above) sees none.
     * Deliberately reads `context.prisma.device` directly rather than through
     * `context.stores.device.list()`/`listForUser()` — reads go through Prisma
     * directly in this schema (see the plan's "Layer boundaries" note), and it is
     * the only way to get `t.prismaField`'s `query` select-merging plus the
     * `createdAt`/`updatedAt` columns, which `DeviceStore`'s `Device` DTO
     * (`app/server/types.ts`) does not carry.
     */
    devices: t.prismaField({
      type: [device],
      resolve: (query, viewerRow, _args, context) => {
        if (viewerRow.isAdmin) {
          return context.prisma.device.findMany({ ...query, orderBy: { name: 'asc' } });
        }
        if (viewerRow.userId === null) return [];
        return context.prisma.device.findMany({
          ...query,
          where: { enabledUsers: { some: { userId: viewerRow.userId } } },
          orderBy: { name: 'asc' },
        });
      },
    }),
  }),
});

import { NOT_CONFIG_ADMIN } from '../../../services/admin-account';
import { getSyncPassword } from '../../../services/password';
import type { Viewer } from '../../context';
import { epochToDate } from '../../derive';
import { builder } from '../builder';
import { model as device } from '../device/model';
import { model as library } from '../library/model';
import { model as user } from '../user/model';

export const model = builder.objectRef<Viewer>('Viewer').implement({
  fields: (t) => ({
    username: t.exposeString('username'),
    isAdmin: t.exposeBoolean('isAdmin'),
    mustChangePassword: t.exposeBoolean('mustChangePassword'),
    // No `mustSetEmail` field here (D3, whole-branch review): it was exposed
    // in the SDL but no client operation ever selected it — the client gates
    // on the JWT claim instead (`AuthUser.mustSetEmail`, `lib/token.ts`).
    // Removed rather than left inert, for the same reason two dead Pothos
    // plugins were removed rather than left in this schema: dead GraphQL
    // surface is a permanent public contract, and leaving it invites someone
    // to re-add it later believing it already works. The JWT claim and
    // `context.ts`'s `Viewer.mustSetEmail` are UNCHANGED — those are
    // load-bearing (`ProtectedRoute`'s gate); only this exposed field goes.

    /**
     * ON `Viewer`, NOT behind `Viewer.user` — deliberately. `Viewer.user` resolves
     * through `v.userId`, which is null for the config-based admin, so an address
     * hung off it would be unreadable by the one account that cannot recover its
     * password any other way. Resolved through `context.loadViewerRow()`
     * (`loaders/viewer-row.ts`), which mirrors `resolveViewerRow`'s dispatch
     * exactly (I3, whole-branch review) — by `userId`, or by the
     * `isConfigAdmin` flag for the admin — NOT by `v.username`: a username
     * lookup can resolve to an unrelated row when `ensureAdminUser`'s rename
     * is blocked by a collision (see that module's doc comment for the full
     * scenario).
     *
     * `email` and `emailVerifiedAt` share the loader's one memoized row
     * fetch rather than each calling `resolveViewerRow` independently — the
     * client's `ViewerBootstrapDocument` selects both on every app load, and
     * that used to cost two round trips. See `loaders/viewer-row.ts`'s doc
     * comment for why this is a read-path-only loader: the mutations that
     * write this row (`viewerSetEmail`, `viewerConfirmEmail`) deliberately do
     * NOT go through it, to avoid ever reading back their own write from a
     * stale cache entry.
     */
    email: t.field({
      type: 'String',
      nullable: true,
      resolve: async (_v, _args, context) => (await context.loadViewerRow())?.email ?? null,
    }),

    emailVerifiedAt: t.field({
      type: 'DateTime',
      nullable: true,
      resolve: async (_v, _args, context) => {
        const row = await context.loadViewerRow();
        return row?.emailVerifiedAt == null ? null : epochToDate(row.emailVerifiedAt);
      },
    }),

    library: t.field({
      type: library,
      nullable: true,
      // Null for the config-based admin, whose token carries no `sub` — v.userId
      // is null for it, and it owns no library.
      resolve: (v, _args, context) => (v.userId === null ? null : context.loadOwner(v.userId)),
    }),

    /**
     * The viewer's own `User` row — the bridge from the root singleton `Viewer`
     * (which is not a `Node`, and has no global ID) to a normalizable `User`
     * node, so Houdini can share one cached `User` between `viewer { user }` and
     * `users`/`node(id:)`.
     *
     * Null for the config-based admin, whose token carries no `sub` —
     * `RefreshToken.userId` is nullable precisely for it, and `v.userId` here is
     * always null in consequence. Same null condition and same reasoning as
     * `Viewer.library` above.
     *
     * The admin now HAS a row (`services/admin-account.ts` — it holds its email
     * address), but its token deliberately still carries no `sub`, so this field
     * stays null for it and every ownership path is unchanged. That is exactly
     * why `Viewer.email` is a field on `Viewer` and not reached through here.
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
     * Mirrored REST's `GET /api/users` (`routes/users.ts`, removed in
     * Phase 0). That whole router applied `router.use(adminAuth)` before any
     * handler, so the list was admin-only — verified against the router
     * itself, not assumed, and it agrees with the design spec's annotation
     * (`users: [User!]! # admin-only scope`). Contrast `Viewer.devices`,
     * whose REST equivalent was deliberately *not* admin-gated.
     *
     * `orderBy: { username: 'asc' }` is `UserStore.listUsers()`'s own ordering,
     * preserved here even though `UserStore` itself is gone: this phase
     * dissolved it and inlined the lookup at this one call site.
     * Read through `context.prisma` rather than a service function because
     * `listUsers()` used to return a `{ username, progressCount }` DTO with
     * no `id` — it could not back a `User` node. `User.progressCount` (see
     * `user/model.ts`) exposes the same `_count.progresses` that DTO
     * carried, so nothing from the REST payload is lost.
     *
     * `where: NOT_CONFIG_ADMIN` — the config admin now HAS a row (it needs one
     * to hold an email address; see `services/admin-account.ts`), but it is not
     * a reader: it owns no library and has no sync credentials. Listing it here
     * would show an empty phantom account in the admin panel. The predicate is
     * imported rather than inlined so the day the admin becomes an ordinary
     * user is a one-line change.
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
        context.prisma.user.findMany({
          ...query,
          where: NOT_CONFIG_ADMIN,
          orderBy: { username: 'asc' },
        }),
    }),

    /**
     * Mirrors `GET /api/my/sync-password` (`routes/ui.ts`): `requireAuth`, then
     * `403` for an admin session, then `getSyncPassword(prisma, username)` for
     * the requesting user's *own* account — there is no route, and no field here,
     * that reads another user's sync password.
     *
     * This is `User.syncPassword` the column, read through `services/password.ts`, but it
     * hangs off `Viewer`, not `User`: `user/model.ts`'s own comment records that
     * `passwordHash`/`syncPassword` are deliberately absent from the `User` node
     * and exposed on `Viewer` only. This field is the "only".
     *
     * REST's `403` for an admin becomes `null` rather than a `FORBIDDEN` error:
     * the field is resolved through `v.userId`, and the config-based admin's
     * token carries no `sub`, so `viewer.userId` is null for it exactly like
     * `Viewer.library`. Erroring would make `{ viewer { username syncPassword } }`
     * fail wholesale for an admin instead of answering the parts that apply.
     * `isAdmin` is the condition REST branches on and is what is reproduced here;
     * for this codebase it coincides with `userId === null`, since admin status
     * comes only from the config-based account, whose token names no row.
     *
     * NOTE — this read has a write side effect, inherited from
     * `services/password.ts`'s `getSyncPassword`: a user whose `sync_password` column is still
     * null gets one generated and persisted on first read. That is REST's
     * behaviour today (the KOSync credential is created lazily on first view), and
     * reproducing it is the point — a GraphQL client and the REST client must not
     * disagree about whether a user has a sync password.
     */
    syncPassword: t.string({
      nullable: true,
      resolve: (v, _args, context) =>
        v.isAdmin ? null : getSyncPassword(context.prisma, v.username),
    }),

    /**
     * Matched REST's `routes/devices.ts`'s `GET /` exactly, before Phase 0
     * removed that router (its handler's own comment read: "Listing devices
     * is open to any user ... creating, editing, and deleting devices stay
     * admin-only"). Every GraphQL field already requires an authenticated
     * viewer (the builder's default `authenticated` scope), so that route's
     * outer `requireAuth` was already covered — the branching below
     * reproduces that handler's OWN branching, not a tightened or loosened
     * version of it:
     *   - an admin sees every device;
     *   - a regular user sees only the devices they are enabled on;
     *   - a viewer with no userId (defensive; only the config-based admin has a
     *     null userId, and that case is already handled above) sees none.
     * Deliberately reads `context.prisma.device` directly rather than through
     * `services/device.ts` — reads go through Prisma directly in this schema
     * (see the plan's "Layer boundaries" note), and it is the only way to get
     * `t.prismaField`'s `query` select-merging plus the `createdAt`/
     * `updatedAt` columns, which the app-level `Device` DTO
     * (`app/server/types.ts`) does not carry. (`list`/`listForUser`, the
     * store methods this once bypassed, were themselves dead code — no
     * production caller ever reached them — and were deleted outright when
     * `DeviceStore` was dissolved.)
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

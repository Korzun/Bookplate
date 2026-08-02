import type { Device } from '../../../types';
import { epochToDate } from '../../derive';
import { builder } from '../builder';
import { model as coverFit } from '../cover-fit';
import { model as user } from '../user/model';

/**
 * Deliberately a prismaObject, not a prismaNode — unlike `Series`/`User`/`Book`,
 * and following `Validation`'s, `Progress`'s and `PendingFix`'s precedent, but
 * for a DIFFERENT reason than theirs. Those three are sub-objects only ever
 * reached through an already owner-scoped parent, so a global ID would be a
 * redundant second door. `Device` is not reached through an owner-scoped
 * parent at all — it has no owner. It is a single, global row shared
 * identically by every user enabled on it, and by every admin regardless of
 * enablement (see `routes/devices.ts`'s `GET /`).
 *
 * node-scope.ts's guard (`ownerScopedFindUnique`/`isOwnerOrAdmin`) and
 * node-scope.test.ts's generic cross-tenant walk exist to answer one
 * question: "does `Query.node(id:)` leak a TENANT-owned row past the owner
 * check its normal field already applies?" That question has no honest
 * answer for `Device`, because there is no tenant to leak across — every
 * viewer who can see a device at all sees the exact same row. Registering
 * `Device` as a `Node` would force a false choice between (a) letting
 * `node(id:)` hand any device to any authenticated viewer, a capability REST
 * does not even offer non-admins directly (only the already-scoped `GET /`
 * list does, via `deviceStore.listForUser`), or (b) inventing an "ownership"
 * relation out of `DeviceUser` enablement that does not exist in REST and
 * that the generic suite's "non-owner sees null / owner sees data" shape does
 * not fit anyway — a device with zero enabled users would have no possible
 * "owner" for the positive control to seed against.
 *
 * `Device` is reached exclusively through `Viewer.devices`
 * (`viewer/model.ts`), which already applies REST's real scoping
 * rule (admin: every device; user: only the devices they are enabled on).
 * That is the one and only door, and it carries the real check — this is not
 * an oversight, it is the considered absence of a second, unnecessary one.
 */
export const model = builder.prismaObject('Device', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    coverWidth: t.exposeInt('coverWidth', { nullable: true }),
    coverHeight: t.exposeInt('coverHeight', { nullable: true }),
    coverFit: t.field({
      type: coverFit,
      resolve: (device) => device.coverFit as Device['coverFit'],
    }),
    bwCover: t.exposeBoolean('bwCover'),
    simplify: t.exposeBoolean('simplify'),
    createdAt: t.field({ type: 'DateTime', resolve: (device) => epochToDate(device.createdAt) }),
    updatedAt: t.field({ type: 'DateTime', resolve: (device) => epochToDate(device.updatedAt) }),

    /**
     * The users enabled on a device — the relation `deviceEnableUser` /
     * `deviceDisableUser` will mutate in phase 4, so the schema must be able to
     * read it.
     *
     * REST equivalent: `GET /api/devices/:id/users` (`routes/devices.ts`), which
     * carries `adminAuth` explicitly, unlike that router's `GET /`. Verified
     * against the router rather than assumed: of its seven routes only `GET /` is
     * ungated; `POST /`, `PATCH /:id`, `DELETE /:id`, `GET /:id/users`,
     * `PUT /:id/users/:username` and `DELETE /:id/users/:username` all carry
     * `adminAuth`. So `Viewer.devices` stays open (see `viewer/model.ts`) and
     * this field is admin-only. The two differ, and that difference is REST's,
     * not an invention here.
     *
     * Typed `[User!]!`, not REST's `[String!]!` of usernames. Every user-associated
     * mutation in the spec takes a `User` global ID, never a username
     * (`deviceEnableUser(deviceId:, userId:)`), so returning usernames would make
     * the read half of this relation unable to feed the write half without a
     * second lookup. `username` is still one field away, so nothing REST returns
     * is lost.
     *
     * `orderBy: { username: 'asc' }` reproduces
     * `DeviceStore.listUsernamesForDevice`'s own `orderBy: { user: { username:
     * 'asc' } }`, and the `deviceAccess.some` filter is the Prisma equivalent of
     * its `deviceUser.findMany({ where: { deviceId } })` join, read from the User
     * side so the rows are `User`s.
     */
    // `nullable: true` (pre-client hardening spec, §4 "Nullability
    // ruling") — same reasoning as `Viewer.users` (viewer/model.ts): a
    // non-null list here would null-propagate a denial past `Device` and
    // up through `Viewer.devices` (itself a list), discarding every OTHER
    // device the same request asked for, not just this one field on this
    // one device.
    enabledUsers: t.prismaField({
      type: [user],
      nullable: true,
      authScopes: { admin: true },
      resolve: (query, deviceRow, _args, context) =>
        context.prisma.user.findMany({
          ...query,
          where: { deviceAccess: { some: { deviceId: deviceRow.id } } },
          orderBy: { username: 'asc' },
        }),
    }),
  }),
});

import { epochToDate } from '../../derive';
import { builder } from '../builder';

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
 * (`device/query/get-all.ts`), which already applies REST's real scoping
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
    coverFit: t.exposeString('coverFit'),
    bwCover: t.exposeBoolean('bwCover'),
    simplify: t.exposeBoolean('simplify'),
    createdAt: t.field({ type: 'DateTime', resolve: (device) => epochToDate(device.createdAt) }),
    updatedAt: t.field({ type: 'DateTime', resolve: (device) => epochToDate(device.updatedAt) }),
  }),
});

import { builder } from '../../builder';
import { model as device } from '../../device';
import { model } from '../index';

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
 * `adminAuth`. So `Viewer.devices` stays open (see
 * `device/query/get-all.ts`) and this field is admin-only. The two differ, and
 * that difference is REST's, not an invention here.
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
 *
 * Registered from `user/` because the field's value type is `User` — the same
 * convention that puts `Viewer.devices` in `device/` and `Book.pendingFix` in
 * `pending-fix/`.
 */
builder.objectField(device, 'enabledUsers', (t) =>
  t.prismaField({
    type: [model],
    authScopes: { admin: true },
    resolve: (query, deviceRow, _args, context) =>
      context.prisma.user.findMany({
        ...query,
        where: { deviceAccess: { some: { deviceId: deviceRow.id } } },
        orderBy: { username: 'asc' },
      }),
  })
);

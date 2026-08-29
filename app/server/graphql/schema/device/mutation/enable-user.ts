import { z } from 'zod';

import { builder } from '../../builder';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as userModel } from '../../user/model';
import { model as deviceModel } from '../model';

/**
 * `deviceId` (raw device row id — see `update.ts`'s identical note) plus
 * `userId`, a `User` global ID per the spec's rule for every user-associated
 * mutation (`deviceEnableUser(deviceId:, userId:)` is the spec's own literal
 * example of this rule).
 */
const input = builder.inputType('DeviceEnableUserInput', {
  fields: (t) => ({
    deviceId: t.string({ required: true }),
    userId: t.globalID({ required: true, for: userModel }),
  }),
});

const inputSchema = z.object({
  deviceId: z.string().min(1, 'deviceId must not be empty'),
});

type DeviceEnableUserPayloadShape = {
  readonly __typename: 'DeviceEnableUserPayload';
  readonly deviceId: string;
  readonly userId: string;
};

/**
 * Both `device` and `user` are fresh `t.prismaField` lookups — same
 * "field resolvers do the lookup" pattern every other payload in this schema
 * uses. Returning both sides of the relation lets a client update whichever
 * screen it's showing (a device's enabled-users list, or — if one is ever
 * added — a user's device-access list) without a second round trip.
 */
const payload = builder
  .objectRef<DeviceEnableUserPayloadShape>('DeviceEnableUserPayload')
  .implement({
    fields: (t) => ({
      device: t.prismaField({
        type: deviceModel,
        resolve: (query, parent, _args, context) =>
          context.prisma.device.findUniqueOrThrow({ ...query, where: { id: parent.deviceId } }),
      }),
      user: t.prismaField({
        type: userModel,
        resolve: (query, parent, _args, context) =>
          context.prisma.user.findUniqueOrThrow({ ...query, where: { id: parent.userId } }),
      }),
    }),
  });

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('DeviceEnableUserResult', {
  types: [payload, invalidInputErrorModel],
});

/**
 * Mirrored REST's `PUT /:id/users/:username`, removed in Phase 0 —
 * admin-only, same router-wide gate `deviceCreate`'s doc comment traces.
 * This is admin-managing-users, not self-service: REST had no equivalent
 * `/api/my/...` route letting a user enable itself on a device, and the
 * whole router (bar `GET /`) was `adminAuth`-gated regardless of whose
 * `userId` was named — including the caller's own. The same shape holds
 * here. Confirmed live
 * (seen-to-fail): a non-admin calling this mutation naming THEMSELVES as
 * `userId` is refused exactly like naming anyone else, which is what
 * discriminates this admin-only `{ admin: true }` scope from an
 * `ownerOf`-style self-service one — see this file's test.
 *
 * REST's two 404s ("Device not found", then "User not found") both collapse
 * into this mutation's single `null` result, the same "no such row"
 * convention every mutation in this schema uses for absence — a client
 * cannot act differently on the two REST messages anyway, and every sibling
 * mutation (`progressDelete`, `bookUpdateMetadata`, …) already merges
 * comparable REST 404 pairs the same way.
 *
 * `userId` resolves through `context.loadOwner`, not a raw id compare: this
 * both confirms the row exists (REST's `getUserIdByUsername` 404 check) and
 * yields the canonical id the `prisma.deviceUser.upsert` call below needs —
 * `args.input.userId.id` is already that same id post-relay-decode, but
 * routing it through `loadOwner` keeps the "no such user" 404 path honest
 * rather than assuming any id-shaped string names a real row.
 *
 * The `prisma.deviceUser.upsert` call below is an upsert keyed on the
 * `(deviceId, userId)` compound primary key — enabling an already-enabled
 * pair is a no-op, not an error, matching REST's `PUT` (idempotent by HTTP
 * convention, and the upsert itself never distinguishes "already enabled"
 * from "newly enabled"). Not wrapped in `toResult`: an upsert on a compound
 * primary key cannot raise a unique-slug conflict or any of the other six
 * known domain errors.
 *
 * No edition-cache purge here: REST's `PUT` route doesn't call one either —
 * granting access creates no stale cache to invalidate (only losing access,
 * `deviceDisableUser`, does).
 */
builder.mutationField('deviceEnableUser', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Grants a user access to a device. Resolves to null when the device or ' +
      'user does not exist.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({ deviceId: args.input.deviceId });
      if (!parsed.success) return invalidInputError(parsed.error);

      const device = await context.prisma.device.findUnique({
        where: { id: parsed.data.deviceId },
      });
      if (device === null) return null;

      const owner = await context.loadOwner(args.input.userId.id);
      if (owner === null) return null;

      await context.prisma.deviceUser.upsert({
        where: { deviceId_userId: { deviceId: device.id, userId: owner.userId } },
        create: { deviceId: device.id, userId: owner.userId },
        update: {},
      });

      return {
        __typename: 'DeviceEnableUserPayload' as const,
        deviceId: device.id,
        userId: owner.userId,
      };
    },
  })
);

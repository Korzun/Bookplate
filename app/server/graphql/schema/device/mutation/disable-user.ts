import { z } from 'zod';

import { builder } from '../../builder';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as userModel } from '../../user/model';
import { model as deviceModel } from '../model';
import { purgeEditionsQuietly } from './purge-quietly';

/**
 * `deviceId` (raw device row id) plus a `User` global ID — see
 * `enable-user.ts`'s identical note.
 */
const input = builder.inputType('DeviceDisableUserInput', {
  fields: (t) => ({
    deviceId: t.string({ required: true }),
    userId: t.globalID({ required: true, for: userModel }),
  }),
});

const inputSchema = z.object({
  deviceId: z.string().min(1, 'deviceId must not be empty'),
});

type DeviceDisableUserPayloadShape = {
  readonly __typename: 'DeviceDisableUserPayload';
  readonly deviceId: string;
  readonly userId: string;
};

/**
 * Both `device` and `user` are fresh `t.prismaField` lookups — same
 * reasoning as `DeviceEnableUserPayload`.
 */
const payload = builder
  .objectRef<DeviceDisableUserPayloadShape>('DeviceDisableUserPayload')
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
const result = builder.unionType('DeviceDisableUserResult', {
  types: [payload, invalidInputErrorModel],
});

/**
 * Mirrored REST's `DELETE /:id/users/:username`, removed in Phase 0 —
 * admin-only, same router-wide gate and admin-managing-users (not self-service) shape as
 * `deviceEnableUser` — see that file's doc comment, including the
 * seen-to-fail note on the self-targeting discrimination test.
 *
 * REST's two 404s ("Device not found", "User not found") collapse into a
 * single `null` result — see `deviceEnableUser`'s identical note.
 *
 * The `prisma.deviceUser.deleteMany` call below is idempotent — disabling an
 * already-disabled (or never-enabled) pair deletes zero rows and reports no
 * error, matching REST's `DELETE` (idempotent by HTTP convention). Not
 * wrapped in `toResult`: a `deleteMany` cannot raise any of the seven known
 * store errors.
 *
 * `editionStore.purgeForDeviceAndUser` runs after every call (REST does the
 * same unconditionally, not just when a row was actually deleted) and is
 * swallowed on failure — see `update.ts`'s identical note and
 * `purge-quietly.ts`.
 */
builder.mutationField('deviceDisableUser', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Revokes a user’s access to a device. Resolves to null when the device ' +
      'or user does not exist.',
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

      await context.prisma.deviceUser.deleteMany({
        where: { deviceId: device.id, userId: owner.userId },
      });

      await purgeEditionsQuietly(
        'deviceDisableUser',
        `device "${device.id}" user "${owner.userId}"`,
        () => context.stores.edition.purgeForDeviceAndUser(device.id, owner.userId)
      );

      return {
        __typename: 'DeviceDisableUserPayload' as const,
        deviceId: device.id,
        userId: owner.userId,
      };
    },
  })
);

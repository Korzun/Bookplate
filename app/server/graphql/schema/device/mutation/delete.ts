import { z } from 'zod';

import { isPrismaError } from '../../../../services/prisma-errors';
import { builder } from '../../builder';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { purgeEditionsQuietly } from './purge-quietly';

/**
 * `deviceId` is the raw device row id, not a `Device` global ID — see
 * `update.ts`'s identical note.
 */
const input = builder.inputType('DeviceDeleteInput', {
  fields: (t) => ({
    deviceId: t.string({ required: true }),
  }),
});

const inputSchema = z.object({
  deviceId: z.string().min(1, 'deviceId must not be empty'),
});

type DeviceDeletePayloadShape = {
  readonly __typename: 'DeviceDeletePayload';
  readonly deletedDeviceId: string;
};

/**
 * `deletedDeviceId`, not `deletedId`: `Device` is deliberately not a `Node`
 * (`device/model.ts`'s doc comment — there is no tenant to scope a `node(id:)`
 * door against), so its `id` field is a plain scalar with no global-id
 * encoding to round-trip — there is nothing to build a `deletedId` from.
 * (`Progress` is also non-`Node`, but is not a precedent here: its `id` IS a
 * computed global ID — see `progress/model.ts` — so `progressDelete` returns
 * `deletedId`. Non-`Node`-ness alone doesn't determine this field's shape;
 * whether the type's `id` is itself a global ID does.) No `library`/parent
 * field alongside it either — `Device` has no owner to carry one for
 * (`userDelete`'s M-1 correction on why a parent field earns its place
 * doesn't apply here: there is no parent list scoped by anything but
 * `deletedDeviceId` itself, and `Viewer.devices`'s list-removal directive
 * keys on exactly that raw id, per spec line 851: "`Device` has an id
 * without implementing `Node`: Houdini keys and normalizes on it").
 */
const payload = builder.objectRef<DeviceDeletePayloadShape>('DeviceDeletePayload').implement({
  fields: (t) => ({
    deletedDeviceId: t.exposeString('deletedDeviceId'),
  }),
});

/**
 * No `resolveType`: the value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('DeviceDeleteResult', {
  types: [payload, invalidInputErrorModel],
});

/**
 * Mirrored REST's `DELETE /:id`, removed in Phase 0 — admin-only, same
 * router-wide gate `deviceCreate`'s doc comment traces.
 *
 * REST checks existence twice (`getById`, then re-checks `delete`'s boolean
 * return) before answering 404 either way. This resolver's own `P2025` catch
 * below folds both cases into one `null` result (returned directly for
 * either "never existed" or "P2025 raced it away"), so a single call is
 * sufficient — the second REST check exists only because the route re-reads
 * the row for its own bookkeeping, not because the two cases need different
 * handling. Collapsed here into one `null` result, same "no such row"
 * convention every delete mutation in this schema uses.
 *
 * The `prisma.device.delete` call below is NOT wrapped in `toResult`: traced
 * end to end, its own `P2025` catch converts a races-with-itself
 * double-delete into `null` — nothing left in its body can throw one of the
 * seven known store errors.
 *
 * `DeviceUser` rows for this device are removed by the DB itself
 * (`DeviceUser.device` is `onDelete: Cascade`, `prisma/schema.prisma`), not
 * by any explicit cleanup here — same as REST, which never touches
 * `device_users` in this route either.
 *
 * `editionStore.purgeForDevice` runs after a successful delete, swallowed on
 * failure — see `update.ts`'s identical note and `purge-quietly.ts`.
 */
builder.mutationField('deviceDelete', (t) =>
  t.field({
    type: result,
    nullable: true,
    description: 'Deletes a device profile. Resolves to null when the device does not exist.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({ deviceId: args.input.deviceId });
      if (!parsed.success) return invalidInputError(parsed.error);

      try {
        await context.prisma.device.delete({ where: { id: parsed.data.deviceId } });
      } catch (err) {
        if (isPrismaError(err, 'P2025')) return null; // already deleted
        throw err;
      }

      await purgeEditionsQuietly('deviceDelete', `device "${parsed.data.deviceId}"`, () =>
        context.stores.edition.purgeForDevice(parsed.data.deviceId)
      );

      return { __typename: 'DeviceDeletePayload' as const, deletedDeviceId: parsed.data.deviceId };
    },
  })
);

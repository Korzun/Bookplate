import { z } from 'zod';

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
 * door against), so it has no global id to return. Same convention
 * `progressDelete`'s `deletedDocument` established for the one other
 * non-`Node` type in this schema: the ledger's "deletes of `Node`-backed
 * entities carry `deletedId`" rule names its exception as non-`Node` types,
 * and `Device` is exactly that exception, not an oversight. No `library`/
 * parent field alongside it either — `Device` has no owner to carry one for
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
 * Mirrors `DELETE /:id` (`routes/devices.ts`) — admin-only, same router-wide
 * gate `deviceCreate`'s doc comment traces.
 *
 * REST checks existence twice (`getById`, then re-checks `delete`'s boolean
 * return) before answering 404 either way. `DeviceStore.delete` already
 * folds both cases into its own return value (`false` for "never existed" or
 * "P2025 raced it away", `device-store.ts:92-99`), so a single call is
 * sufficient — the second REST check exists only because the route re-reads
 * the row for its own bookkeeping, not because the two cases need different
 * handling. Collapsed here into one `null` result, same "no such row"
 * convention every delete mutation in this schema uses.
 *
 * `DeviceStore.delete` is NOT wrapped in `toResult`: traced end to end, its
 * own `P2025` catch converts a races-with-itself double-delete into `false`
 * — nothing left in its body can throw one of the seven known store errors.
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

      const deleted = await context.stores.device.delete(parsed.data.deviceId);
      if (!deleted) return null;

      await purgeEditionsQuietly('deviceDelete', () =>
        context.stores.edition.purgeForDevice(parsed.data.deviceId)
      );

      return { __typename: 'DeviceDeletePayload' as const, deletedDeviceId: parsed.data.deviceId };
    },
  })
);

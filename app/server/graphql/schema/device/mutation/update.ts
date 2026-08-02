import { z } from 'zod';

import { DeviceSlugConflictError, type DeviceInput } from '../../../../services/device-store';
import type { Device } from '../../../../types';
import { generateSlug } from '../../../../utils/slug';
import { assertUnreachableStoreError, toResult } from '../../../to-result';
import { builder } from '../../builder';
import { model as coverFit } from '../../cover-fit/model';
import {
  deviceSlugConflictError,
  model as deviceSlugConflictErrorModel,
} from '../../device-slug-conflict-error/model';
import {
  invalidInputError,
  model as invalidInputErrorModel,
} from '../../invalid-input-error/model';
import { model as deviceModel } from '../model';
import { purgeEditionsQuietly } from './purge-quietly';

/**
 * `deviceId` is the raw device row id, NOT a `Device` global ID — `Device` is
 * deliberately not a `Node` (`device/model.ts`'s doc comment), so it has no
 * global-id scheme to decode. This is the same "raw id, plain string" shape
 * `bookId` uses everywhere in this schema (`bookDelete`, `bookUpdateMetadata`,
 * …), for the same reason: nothing here needs relay-style opacity.
 *
 * `PATCH /:id` (`routes/devices.ts`) takes the exact same body shape
 * `POST /` does — REST's `parseBody` is the one function both routes call —
 * so this is a full replacement, not a partial patch despite the HTTP verb:
 * every field is required, exactly like `DeviceCreateInput`.
 */
const input = builder.inputType('DeviceUpdateInput', {
  fields: (t) => ({
    deviceId: t.string({ required: true }),
    name: t.string({ required: true }),
    coverWidth: t.int({ required: false }),
    coverHeight: t.int({ required: false }),
    coverFit: t.field({ type: coverFit, required: true }),
    bwCover: t.boolean({ required: true }),
    simplify: t.boolean({ required: true }),
  }),
});

/**
 * `deviceId.min(1)` has no REST analogue (`PATCH /:id`'s path segment can't
 * be empty) but matches every other id-like field's rule in this schema
 * (`bookId`, `progressDelete`'s `document`, …) — an empty string is a client
 * bug, not a valid lookup. `name`/`coverWidth`/`coverHeight` are identical to
 * `DeviceCreateInput`'s schema — see that file's doc comment.
 */
const inputSchema = z.object({
  deviceId: z.string().min(1, 'deviceId must not be empty'),
  name: z
    .string()
    .trim()
    .min(1, 'name is required')
    .max(50, 'name must be 50 characters or fewer')
    .refine(
      (value) => generateSlug(value).length > 0,
      'name must contain at least one letter or number'
    ),
  coverWidth: z.number().positive('coverWidth must be a positive integer').nullable(),
  coverHeight: z.number().positive('coverHeight must be a positive integer').nullable(),
});

type DeviceUpdatePayloadShape = {
  readonly __typename: 'DeviceUpdatePayload';
  readonly deviceId: string;
};

/**
 * `device` is a fresh `t.prismaField` lookup, never the store's own return
 * value — same reasoning as `DeviceCreatePayload.device`.
 */
const payload = builder.objectRef<DeviceUpdatePayloadShape>('DeviceUpdatePayload').implement({
  fields: (t) => ({
    device: t.prismaField({
      type: deviceModel,
      resolve: (query, parent, _args, context) =>
        context.prisma.device.findUniqueOrThrow({ ...query, where: { id: parent.deviceId } }),
    }),
  }),
});

/**
 * No `resolveType`: every member value carries its own `__typename` — see
 * `progress/mutation/delete.ts`'s identical note.
 */
const result = builder.unionType('DeviceUpdateResult', {
  types: [payload, invalidInputErrorModel, deviceSlugConflictErrorModel],
});

/**
 * Mirrors `PATCH /:id` (`routes/devices.ts`) — admin-only, same router-wide
 * gate `deviceCreate`'s doc comment traces. Two REST 404s collapse into this
 * mutation's single `null` result, the same "no such row" convention every
 * delete/update mutation in this schema uses: the device doesn't exist
 * before the write, or a P2025 races the write out from under it
 * (`DeviceStore.update`'s own `P2025` catch, `device-store.ts:84`) — REST
 * answers "Device not found" for both, and so does this.
 *
 * The slug-conflict handling is the same deliberate simplification
 * `deviceCreate` documents: REST's `getBySlug` precheck (excluding the row
 * being updated) is redundant with `DeviceStore.update`'s own
 * `DeviceSlugConflictError` throw on the DB's unique constraint, so only the
 * throw is mirrored here, via `toResult`. Renaming a device to its OWN
 * current name is not a conflict either way — updating a unique column to
 * the value it already holds never violates the constraint.
 *
 * `editionStore.purgeForDevice` runs after a successful update — REST does
 * the same (`routes/devices.ts`'s `PATCH /:id`, "settings changed -> stale
 * cache") and swallows a purge failure with a warning rather than failing the
 * request; see `purge-quietly.ts` for why that swallow lives outside this
 * `resolve` body.
 */
builder.mutationField('deviceUpdate', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Replaces a device profile’s settings. Resolves to null when the device ' + 'does not exist.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({
        deviceId: args.input.deviceId,
        name: args.input.name,
        coverWidth: args.input.coverWidth ?? null,
        coverHeight: args.input.coverHeight ?? null,
      });
      if (!parsed.success) return invalidInputError(parsed.error);

      const existing = await context.stores.device.getById(parsed.data.deviceId);
      if (existing === null) return null;

      const deviceInput: DeviceInput = {
        name: parsed.data.name,
        coverWidth: parsed.data.coverWidth,
        coverHeight: parsed.data.coverHeight,
        coverFit: args.input.coverFit,
        bwCover: args.input.bwCover,
        simplify: args.input.simplify,
      };

      const outcome = await toResult<Device | null, DeviceSlugConflictError>(
        () => context.stores.device.update(existing.id, deviceInput),
        [DeviceSlugConflictError]
      );
      if ('err' in outcome) {
        if (outcome.err instanceof DeviceSlugConflictError) {
          return deviceSlugConflictError(outcome.err, generateSlug(parsed.data.name));
        }
        return assertUnreachableStoreError(outcome.err);
      }
      if (outcome.ok === null) return null;

      await purgeEditionsQuietly('deviceUpdate', () =>
        context.stores.edition.purgeForDevice(existing.id)
      );

      return { __typename: 'DeviceUpdatePayload' as const, deviceId: outcome.ok.id };
    },
  })
);

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
import { deviceFieldsSchema } from './device-fields-schema';
import { purgeEditionsQuietly } from './purge-quietly';

/**
 * `deviceId` is the raw device row id, NOT a `Device` global ID — `Device` is
 * deliberately not a `Node` (`device/model.ts`'s doc comment), so it has no
 * global-id scheme to decode. (Book mutations once took the same raw-id shape;
 * the Book-Relay-ID pass moved them to `id: ID!` because Book IS a Node with a
 * compound key to encode. Device has neither, so the raw id stays honest here.)
 *
 * REST's `PATCH /:id` took the exact same body shape `POST /` did — its
 * `parseBody` was the one function both routes called, before Phase 0
 * removed that router — so this is a full replacement, not a partial patch
 * despite the HTTP verb: every field is required, exactly like
 * `DeviceCreateInput`.
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
 * (`bookId`, `deviceDelete`'s `deviceId`, …) — an empty string is a client
 * bug, not a valid lookup. Kept as its OWN schema, separate from
 * `deviceFieldsSchema`, because an empty `deviceId` is a malformed
 * identifier rather than a bad field value — checking it first means an
 * unusable id is reported before the resolver bothers validating the body.
 */
const deviceIdSchema = z.object({
  deviceId: z.string().min(1, 'deviceId must not be empty'),
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
 * Mirrored REST's `PATCH /:id`, removed in Phase 0 — admin-only, same
 * router-wide gate `deviceCreate`'s doc comment traces. Two REST 404s
 * collapsed into this mutation's single `null` result, the same "no such
 * row" convention every delete/update mutation in this schema uses: the
 * device doesn't exist before the write, or a P2025 races the write out
 * from under it (`DeviceStore.update`'s own `P2025` catch,
 * `device-store.ts:84`) — REST answered "Device not found" for both, and so
 * does this.
 *
 * **Ordering:** validates before it resolves, like every other mutation in
 * this schema. An input that is both an unknown device and a malformed body
 * reports the malformed body. This deliberately inverts the behaviour of the
 * removed `PATCH /api/devices/:id`, which checked existence first — the
 * spec's Resolved decision D-1 chose this schema's own convention over a
 * dead endpoint's ordering.
 *
 * No `getById` precheck: `DeviceStore.update` already converts `P2025` to
 * `null` and `P2002` to `DeviceSlugConflictError`, so the outcome is decided
 * by which constraint failed, not by evaluation order. The precheck was one
 * extra query and nothing else.
 *
 * The slug-conflict handling is the same deliberate simplification
 * `deviceCreate` documents: REST's `getBySlug` precheck (excluding the row
 * being updated) is redundant with `DeviceStore.update`'s own
 * `DeviceSlugConflictError` throw on the DB's unique constraint, so only the
 * throw is mirrored here, via `toResult`. Renaming a device to its OWN
 * current name is not a conflict either way — updating a unique column to
 * the value it already holds never violates the constraint.
 *
 * `message` deliberately carries the store's own text, not REST's
 * route-specific "Slug already in use" — see `create.ts`'s identical note
 * (review, task 7, M-6).
 *
 * `editionStore.purgeForDevice` runs after a successful update — REST did
 * the same on its `PATCH /:id` ("settings changed -> stale cache"), before
 * Phase 0 removed that route, and swallowed a purge failure with a warning
 * rather than failing the request; see `purge-quietly.ts` for why that
 * swallow lives outside this `resolve` body.
 */
builder.mutationField('deviceUpdate', (t) =>
  t.field({
    type: result,
    nullable: true,
    description:
      'Replaces a device profile’s settings. Resolves to null when the device does not exist.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const idParsed = deviceIdSchema.safeParse({ deviceId: args.input.deviceId });
      if (!idParsed.success) return invalidInputError(idParsed.error);

      const fieldsParsed = deviceFieldsSchema.safeParse({
        name: args.input.name,
        coverWidth: args.input.coverWidth ?? null,
        coverHeight: args.input.coverHeight ?? null,
      });
      if (!fieldsParsed.success) return invalidInputError(fieldsParsed.error);

      const deviceInput: DeviceInput = {
        name: fieldsParsed.data.name,
        coverWidth: fieldsParsed.data.coverWidth,
        coverHeight: fieldsParsed.data.coverHeight,
        coverFit: args.input.coverFit,
        bwCover: args.input.bwCover,
        simplify: args.input.simplify,
      };

      const outcome = await toResult<Device | null, DeviceSlugConflictError>(
        () => context.stores.device.update(idParsed.data.deviceId, deviceInput),
        [DeviceSlugConflictError]
      );
      if ('err' in outcome) {
        if (outcome.err instanceof DeviceSlugConflictError) {
          return deviceSlugConflictError(outcome.err, generateSlug(fieldsParsed.data.name));
        }
        return assertUnreachableStoreError(outcome.err);
      }
      const device = outcome.ok;
      if (device === null) return null;

      await purgeEditionsQuietly('deviceUpdate', `device "${device.id}"`, () =>
        context.stores.edition.purgeForDevice(device.id)
      );

      return { __typename: 'DeviceUpdatePayload' as const, deviceId: device.id };
    },
  })
);

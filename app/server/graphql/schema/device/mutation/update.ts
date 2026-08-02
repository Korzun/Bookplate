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
 * bug, not a valid lookup. Kept as its OWN schema, separate from
 * `deviceFieldsSchema`, so it can be checked and used to look the device up
 * BEFORE the `name`/`coverWidth`/`coverHeight` fields are validated — see the
 * resolver's doc comment (review, task 7, M-2) for why the two are ordered
 * that way.
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
 * Mirrors `PATCH /:id` (`routes/devices.ts`) — admin-only, same router-wide
 * gate `deviceCreate`'s doc comment traces. Two REST 404s collapse into this
 * mutation's single `null` result, the same "no such row" convention every
 * delete/update mutation in this schema uses: the device doesn't exist
 * before the write, or a P2025 races the write out from under it
 * (`DeviceStore.update`'s own `P2025` catch, `device-store.ts:84`) — REST
 * answers "Device not found" for both, and so does this.
 *
 * **Ordering (review, task 7, M-2):** REST checks existence (`getById` → 404)
 * BEFORE parsing the body (`parseBody` → 400) — `routes/devices.ts:111-119`.
 * This resolver mirrors that order literally: `deviceId` is validated and
 * looked up first, and only once the device is confirmed to exist does
 * `deviceFieldsSchema` run against `name`/`coverWidth`/`coverHeight`. For an
 * input that fails both (an unknown `deviceId` AND a blank/oversized `name`),
 * this returns `null` (REST's 404), never `InvalidInputError` — pinned by a
 * dedicated test below. Every OTHER mutation in this schema validates first,
 * then resolves — this is the one deliberate exception, because it is the
 * one case where REST's own ordering is observable and worth matching
 * exactly rather than defaulting to this schema's usual convention.
 *
 * **`getById` is kept even though it's outcome-redundant with
 * `DeviceStore.update`'s own `P2025`-to-`null` conversion (review, task 7,
 * M-4)**, unlike the `getBySlug` prechecks below, which are dropped. Two
 * reasons, not one: (1) the ordering guarantee above — REST answers 404
 * before ever looking at the body, and the only way to reproduce that here
 * is to resolve existence before parsing `deviceFieldsSchema`, which needs a
 * confirmed-existing device to compare a rename against in the first place;
 * (2) without it, "does a malformed body on an unknown device 404 or 400"
 * would depend on Prisma's own internal ordering between resolving the
 * `WHERE id = ...` clause and evaluating the `slug` unique constraint on the
 * `UPDATE` — an implementation detail of the database driver, not a decision
 * this resolver should delegate to. `getBySlug` has no equivalent stake:
 * dropping it changes nothing about ordering (the slug conflict is still
 * only knowable after parsing) or determinism (the DB's constraint is
 * already authoritative either way — see the note below).
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
      'Replaces a device profile’s settings. Resolves to null when the device does not exist.',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const idParsed = deviceIdSchema.safeParse({ deviceId: args.input.deviceId });
      if (!idParsed.success) return invalidInputError(idParsed.error);

      const existing = await context.stores.device.getById(idParsed.data.deviceId);
      if (existing === null) return null;

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
        () => context.stores.device.update(existing.id, deviceInput),
        [DeviceSlugConflictError]
      );
      if ('err' in outcome) {
        if (outcome.err instanceof DeviceSlugConflictError) {
          return deviceSlugConflictError(outcome.err, generateSlug(fieldsParsed.data.name));
        }
        return assertUnreachableStoreError(outcome.err);
      }
      if (outcome.ok === null) return null;

      await purgeEditionsQuietly('deviceUpdate', `device "${existing.id}"`, () =>
        context.stores.edition.purgeForDevice(existing.id)
      );

      return { __typename: 'DeviceUpdatePayload' as const, deviceId: outcome.ok.id };
    },
  })
);

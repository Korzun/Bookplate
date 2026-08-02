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

/**
 * Every field `POST /api/devices` (`routes/devices.ts`'s `parseBody`)
 * requires, plus the two optional dimensions. `Device` has no owner — unlike
 * every book/progress/user mutation in this schema, there is no `userId`
 * here at all (see `device/model.ts`'s doc comment on why `Device` is a
 * single global record, not tenant-scoped).
 *
 * `coverFit` reuses the existing `CoverFit` enum (`cover-fit/model.ts`) — its
 * `value:` mapping already produces the lowercase storage string
 * `DeviceInput['coverFit']` expects, so `args.input.coverFit` needs no
 * translation before it reaches the store.
 */
const input = builder.inputType('DeviceCreateInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    coverWidth: t.int({ required: false }),
    coverHeight: t.int({ required: false }),
    coverFit: t.field({ type: coverFit, required: true }),
    bwCover: t.boolean({ required: true }),
    simplify: t.boolean({ required: true }),
  }),
});

/**
 * Mirrors `parseBody`'s checks on `name` exactly, in the same order:
 * required-after-trim, then the 50-character ceiling, then the "must derive
 * a non-empty slug" rule (a symbol-only name such as `"!!!"` would otherwise
 * break the unique `slug` column and the `/devices/:slug/download` URL).
 * `coverWidth`/`coverHeight` mirror `parseBody`'s `dim` helper: omitted or
 * explicit `null` both mean "no cap" (`DeviceInput`'s `number | null`), and a
 * provided value must be a positive integer. No `.int()` check — GraphQL's
 * `Int` coercion already rejects a non-integer before the resolver runs (see
 * `progressSet`'s identical note on `currentChapter`), so only positivity is
 * left to check.
 */
const inputSchema = z.object({
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

type DeviceCreatePayloadShape = {
  readonly __typename: 'DeviceCreatePayload';
  readonly deviceId: string;
};

/**
 * `device` is a fresh `t.prismaField` lookup by the id the store call
 * reported, never the store's own return value handed straight to a
 * `prismaObject` field — same "field resolvers do the lookup" pattern every
 * other payload in this schema uses (`BookUpdateMetadataPayload.book`,
 * `UserRegisterPayload.user`), and required here for the same reason: a
 * `prismaObject` field expects a real Prisma row shape, not an arbitrary
 * plain object, even one with matching field names.
 */
const payload = builder.objectRef<DeviceCreatePayloadShape>('DeviceCreatePayload').implement({
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
const result = builder.unionType('DeviceCreateResult', {
  types: [payload, invalidInputErrorModel, deviceSlugConflictErrorModel],
});

/**
 * Mirrors `POST /api/devices` (`routes/devices.ts`) — `router.use(adminAuth)`
 * (after `router.use(requireAuth)`) gates every route in this router except
 * `GET /`, which is open to any authenticated user (verified by reading
 * every route end to end, not assumed from the task brief — the read-model
 * plan's `Viewer.devices` doc comment records the identical finding). No
 * `ownerOf` alternative exists: devices are not owned by any user.
 *
 * REST runs a `getBySlug` precheck (409) AND catches `DeviceSlugConflictError`
 * from `deviceStore.create` itself (a second 409, defense against a race
 * between the precheck and the write) — both produce the identical response.
 * This resolver keeps only the second: `DeviceStore.create` already throws
 * `DeviceSlugConflictError` on the DB's own unique-constraint violation
 * (`device-store.ts:18`, backed by `slug @unique` in `prisma/schema.prisma`),
 * so the precheck is redundant for outcome purposes — it exists in REST only
 * to avoid an unnecessary write attempt, not to produce a different result.
 * Relying solely on the store's real throw, via `toResult`, is also more in
 * keeping with this schema's "`toResult` is the single boundary" discipline
 * than fabricating a synthetic `DeviceSlugConflictError` instance to match a
 * precheck that has no separate observable behaviour. Flagged here as a
 * deliberate simplification, not an oversight.
 *
 * `DeviceSlugConflictError` carries no data of its own (`device-store.ts`'s
 * class has a zero-arg constructor) — the SDL's `slug` field is filled in
 * from `generateSlug(parsed.data.name)`, the same derivation the store
 * itself would have applied, per the ledger's binding rule for this type.
 */
builder.mutationField('deviceCreate', (t) =>
  t.field({
    type: result,
    description: 'Registers a new device profile (KOReader/OPDS cover transforms).',
    args: { input: t.arg({ type: input, required: true }) },
    authScopes: { admin: true },
    resolve: async (_parent, args, context) => {
      const parsed = inputSchema.safeParse({
        name: args.input.name,
        coverWidth: args.input.coverWidth ?? null,
        coverHeight: args.input.coverHeight ?? null,
      });
      if (!parsed.success) return invalidInputError(parsed.error);

      const deviceInput: DeviceInput = {
        name: parsed.data.name,
        coverWidth: parsed.data.coverWidth,
        coverHeight: parsed.data.coverHeight,
        coverFit: args.input.coverFit,
        bwCover: args.input.bwCover,
        simplify: args.input.simplify,
      };

      const outcome = await toResult<Device, DeviceSlugConflictError>(
        () => context.stores.device.create(deviceInput),
        [DeviceSlugConflictError]
      );
      if ('err' in outcome) {
        if (outcome.err instanceof DeviceSlugConflictError) {
          return deviceSlugConflictError(outcome.err, generateSlug(parsed.data.name));
        }
        return assertUnreachableStoreError(outcome.err);
      }

      return { __typename: 'DeviceCreatePayload' as const, deviceId: outcome.ok.id };
    },
  })
);

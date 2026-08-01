import type { DeviceSlugConflictError as StoreError } from '../../../services/device-store';
import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * `DeviceSlugConflictError` is raised from a Prisma P2002 on the unique `slug`
 * column (`device-store.ts:18`) and — unlike the book-store errors — carries
 * NO data: the store never puts the offending slug on it. So the slug the SDL
 * promises has to come from the caller, which is the only side that knows it:
 * `generateSlug(input.name)`, the same derivation `DeviceStore` applied before
 * the insert. Task 7's device mutations pass it in.
 */
export type DeviceSlugConflictErrorShape = {
  readonly __typename: 'DeviceSlugConflictError';
  readonly message: string;
  readonly slug: string;
};

export const deviceSlugConflictError = (
  error: StoreError,
  slug: string
): DeviceSlugConflictErrorShape => ({
  __typename: 'DeviceSlugConflictError',
  message: error.message,
  slug,
});

export const model = builder
  .objectRef<DeviceSlugConflictErrorShape>('DeviceSlugConflictError')
  .implement({
    description: 'Another device already uses the slug this name derives to.',
    interfaces: [userError],
    fields: (t) => ({
      slug: t.exposeString('slug'),
    }),
  });

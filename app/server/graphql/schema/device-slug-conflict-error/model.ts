import type { DeviceSlugConflictError as StoreError } from '../../../services/device';
import { builder } from '../builder';
import { model as userError } from '../user-error';

/**
 * `DeviceSlugConflictError` is raised from a Prisma P2002 on the unique `slug`
 * column (`deviceCreate`/`deviceUpdate`'s own catch, `graphql/schema/device/
 * mutation/{create,update}.ts`) and — unlike the book domain errors — carries
 * NO data: the class has a zero-arg constructor, so nothing puts the
 * offending slug on it. So the slug the SDL promises has to come from the
 * caller, which is the only side that knows it: `generateSlug(input.name)`,
 * the same derivation the mutation applies before the insert/update. Task 7's
 * device mutations pass it in.
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

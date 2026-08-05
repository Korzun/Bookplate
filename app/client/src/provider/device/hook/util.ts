import type { CoverFit } from '~/gql/graphql';

import { DeviceList } from '../type';
import type { Device } from '../type';

export const removeDeviceById = (id: string, { [id]: _, ...rest }: DeviceList) => rest;

/**
 * The server's `CoverFit` enum is SCREAMING_CASE; the client `Device` type has
 * always used lowercase (`'contain' | 'cover' | 'fill' | 'smart'`), predating
 * this migration. Mapped explicitly, field by field, rather than lower-cased
 * and cast — a cast would silently accept a future enum member this map does
 * not yet know about.
 *
 * Task 3 (mutations) needs the inverse of this map; it lives here so that task
 * can import both from one place.
 */
const COVER_FIT_FROM_GRAPHQL: Record<CoverFit, Device['coverFit']> = {
  CONTAIN: 'contain',
  COVER: 'cover',
  FILL: 'fill',
  SMART: 'smart',
};

export const coverFitFromGraphQL = (coverFit: CoverFit): Device['coverFit'] =>
  COVER_FIT_FROM_GRAPHQL[coverFit];

/**
 * The inverse of `COVER_FIT_FROM_GRAPHQL` above, for mutation inputs: the
 * client's lowercase `Device['coverFit']` union to the GraphQL `CoverFit`
 * enum. Explicit and exhaustive like its counterpart — no lower/upper-casing
 * cast that would silently accept a future client value this map does not
 * yet know about.
 */
const COVER_FIT_TO_GRAPHQL: Record<Device['coverFit'], CoverFit> = {
  contain: 'CONTAIN',
  cover: 'COVER',
  fill: 'FILL',
  smart: 'SMART',
};

export const coverFitToGraphQL = (coverFit: Device['coverFit']): CoverFit =>
  COVER_FIT_TO_GRAPHQL[coverFit];

/**
 * Shared by `useCreateDevice`/`useUpdateDevice` to map a mutation payload's
 * `device { … }` selection (identical field-for-field to `DeviceListDocument`)
 * back to the client's `Device` shape — the same job `useDeviceList` does per
 * row, factored out so both mutation hooks return a `Device` without
 * duplicating the mapping.
 */
export type GraphQLDeviceFields = {
  id: string;
  name: string;
  slug: string;
  coverWidth: number | null;
  coverHeight: number | null;
  coverFit: CoverFit;
  bwCover: boolean;
  simplify: boolean;
};

export const deviceFromGraphQL = (device: GraphQLDeviceFields): Device => ({
  id: device.id,
  name: device.name,
  slug: device.slug,
  coverWidth: device.coverWidth,
  coverHeight: device.coverHeight,
  coverFit: coverFitFromGraphQL(device.coverFit),
  bwCover: device.bwCover,
  simplify: device.simplify,
});

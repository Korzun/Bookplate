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

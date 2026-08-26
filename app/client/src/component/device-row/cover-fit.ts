import type { CoverFit } from '~/gql/graphql';

/**
 * The server's `CoverFit` enum is SCREAMING_CASE. Before fragment
 * colocation, `provider/device/hook/util.ts` mapped it down to a lowercase
 * client union on every row and this formatter title-cased that. Colocation
 * deleted the shaping pass, so this now formats the SERVER enum directly.
 *
 * Exhaustive `Record`s, not casts, in both directions — a cast would
 * silently accept a future enum member neither map knows about.
 */
const COVER_FIT_LABEL: Record<CoverFit, string> = {
  CONTAIN: 'Contain',
  COVER: 'Cover',
  FILL: 'Fill',
  SMART: 'Smart',
};

export const formatCoverFit = (coverFit: CoverFit): string => COVER_FIT_LABEL[coverFit];

/**
 * Still needed on the WRITE side: `DeviceForm` holds its pending cover-fit
 * choice as a lowercase client value and must send the server enum.
 */
const COVER_FIT_TO_GRAPHQL: Record<'contain' | 'cover' | 'fill' | 'smart', CoverFit> = {
  contain: 'CONTAIN',
  cover: 'COVER',
  fill: 'FILL',
  smart: 'SMART',
};

export const coverFitToGraphQL = (coverFit: keyof typeof COVER_FIT_TO_GRAPHQL): CoverFit =>
  COVER_FIT_TO_GRAPHQL[coverFit];

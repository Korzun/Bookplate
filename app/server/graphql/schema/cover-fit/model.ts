import type { Device } from '../../../types';
import { builder } from '../builder';

/**
 * Mirrors `Device.coverFit` in `types.ts`. Member names are SCREAMING_CASE
 * per GraphQL convention; `value:` maps to the stored lowercase — see the
 * cleanup spec, §"1. Enums". The value union is `satisfies`-checked against
 * `Device['coverFit']` (imported, not hand-duplicated) so the two cannot
 * silently drift apart.
 */
export const model = builder.enumType('CoverFit', {
  values: {
    CONTAIN: { value: 'contain' },
    COVER: { value: 'cover' },
    FILL: { value: 'fill' },
    SMART: { value: 'smart' },
  } as const satisfies Record<Uppercase<Device['coverFit']>, { value: Device['coverFit'] }>,
});

import type { ValidationThreshold } from '@korzun/epubcheck-ts';

import { builder } from '../builder';

/**
 * Mirrors `ValidationThreshold` in `@korzun/epubcheck-ts`. Stored and wire
 * values coincide (both already SCREAMING_CASE) — see the cleanup spec,
 * §"1. Enums". The value union is `satisfies`-checked against
 * `ValidationThreshold` (imported, not hand-duplicated) so the two cannot
 * silently drift apart.
 */
export const model = builder.enumType('ValidationThreshold', {
  values: {
    NONE: { value: 'NONE' },
    FATAL: { value: 'FATAL' },
    ERROR: { value: 'ERROR' },
    WARNING: { value: 'WARNING' },
    INFO: { value: 'INFO' },
    USAGE: { value: 'USAGE' },
  } as const satisfies Record<ValidationThreshold, { value: ValidationThreshold }>,
});

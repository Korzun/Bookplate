import { builder } from '../builder';

/**
 * Mirrors `ValidationThreshold` in `@korzun/epubcheck-ts`. Stored and wire
 * values coincide (both already SCREAMING_CASE) — see the cleanup spec,
 * §"1. Enums".
 */
export const model = builder.enumType('ValidationThreshold', {
  values: {
    NONE: { value: 'NONE' },
    FATAL: { value: 'FATAL' },
    ERROR: { value: 'ERROR' },
    WARNING: { value: 'WARNING' },
    INFO: { value: 'INFO' },
    USAGE: { value: 'USAGE' },
  } as const,
});

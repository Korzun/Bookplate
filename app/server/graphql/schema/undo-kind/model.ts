import type { UndoSnapshot } from '../../../types';
import { builder } from '../builder';

/**
 * Mirrors `UndoSnapshot.kind` in `types.ts`. Member names are SCREAMING_CASE
 * per GraphQL convention; `value:` maps to the stored lowercase — see the
 * cleanup spec, §"1. Enums". The value union is `satisfies`-checked against
 * `UndoSnapshot['kind']` (imported, not hand-duplicated) so the two cannot
 * silently drift apart.
 */
export const model = builder.enumType('UndoKind', {
  values: {
    APPLY: { value: 'apply' },
    DISMISS: { value: 'dismiss' },
  } as const satisfies Record<'APPLY' | 'DISMISS', { value: UndoSnapshot['kind'] }>,
});

import type { PendingFixState } from '../../../types';
import { builder } from '../builder';
import { model as metadataFix } from '../metadata-fix';
import { model as undoSnapshot } from '../undo-snapshot';

/**
 * Mirrors `PendingFixState` in `types.ts`. `PendingFix.state` resolves into
 * this type via `parsePendingFixState` (`derive.ts`), the same total parser
 * `getPendingFixes` (`book-store.ts`)'s DTO reading agrees with — see the
 * cleanup spec, §"2. Typed PendingFixState".
 */
export const model = builder.objectRef<PendingFixState>('PendingFixState').implement({
  fields: (t) => ({
    autoFixes: t.field({ type: [metadataFix], resolve: (state) => state.autoFixes }),
    appliedFixes: t.field({ type: [metadataFix], resolve: (state) => state.appliedFixes }),
    proposals: t.field({ type: [metadataFix], resolve: (state) => state.proposals }),
    undo: t.field({ type: undoSnapshot, nullable: true, resolve: (state) => state.undo }),
  }),
});

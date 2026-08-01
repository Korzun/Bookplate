import type { UndoSnapshot } from '../../../types';
import { builder } from '../builder';
import { model as metadataFix } from '../metadata-fix';
import { model as undoKind } from '../undo-kind';

/**
 * Mirrors `UndoSnapshot` in `types.ts`. `originalMetadata` is deliberately
 * left off — it is not part of the cleanup spec's SDL for this type (§"2.
 * Typed PendingFixState") and no field here reads it.
 */
export const model = builder.objectRef<UndoSnapshot>('UndoSnapshot').implement({
  fields: (t) => ({
    kind: t.field({ type: undoKind, resolve: (undo) => undo.kind }),
    proposals: t.field({ type: [metadataFix], resolve: (undo) => undo.proposals }),
    appliedFixes: t.field({ type: [metadataFix], resolve: (undo) => undo.appliedFixes }),
  }),
});

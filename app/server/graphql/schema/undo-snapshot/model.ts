import type { UndoSnapshot } from '../../../types';
import { builder } from '../builder';
import { model as metadataFix } from '../metadata-fix';
import { model as undoKind } from '../undo-kind';

/**
 * Mirrors `UndoSnapshot` in `types.ts`. `originalMetadata` is deliberately
 * left off — it is not part of the cleanup spec's SDL for this type and no
 * field here reads it. Still true after step 9, which makes `ACCEPT` persist
 * that field: its only reader is the `UNDO` action inside
 * `book/mutation/resolve-pending-fix.ts`, server-side. The client reads a
 * snapshot's existence and `kind` and nothing else.
 */
export const model = builder.objectRef<UndoSnapshot>('UndoSnapshot').implement({
  fields: (t) => ({
    kind: t.field({ type: undoKind, resolve: (undo) => undo.kind }),
    proposals: t.field({ type: [metadataFix], resolve: (undo) => undo.proposals }),
    appliedFixes: t.field({ type: [metadataFix], resolve: (undo) => undo.appliedFixes }),
  }),
});

import type { ScanJobStatus } from '../../../services/scan-events';
import { builder } from '../builder';

/**
 * Mirrors `ScanJob.status` (`services/scan-events.ts`). The value union is
 * `satisfies`-checked against `ScanJobStatus` (imported, not hand-duplicated)
 * so the two cannot silently drift apart — see the cleanup spec, §"1. Enums".
 */
export const model = builder.enumType('ScanState', {
  values: {
    RUNNING: { value: 'running' },
    COMPLETED: { value: 'completed' },
    FAILED: { value: 'failed' },
  } as const satisfies Record<'RUNNING' | 'COMPLETED' | 'FAILED', { value: ScanJobStatus }>,
});

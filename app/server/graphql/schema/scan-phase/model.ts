import type { ScanPhase as DomainScanPhase } from '../../../services/scan-events';
import { builder } from '../builder';

/**
 * Mirrors `ScanJob.phase` (`services/scan-events.ts`, derived from
 * `ScanProgress['phase']`). `satisfies`-checked against the service's own union
 * so the two cannot silently drift apart — see the cleanup spec, §"1. Enums".
 */
export const model = builder.enumType('ScanPhase', {
  values: {
    IMPORTING: { value: 'importing' },
    PRUNING: { value: 'pruning' },
  } as const satisfies Record<'IMPORTING' | 'PRUNING', { value: DomainScanPhase }>,
});

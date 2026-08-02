import type { ScanJob } from '../../../services/scan-events';
import type { Owner } from '../../../types';
import { epochToDate } from '../../derive';
import { builder } from '../builder';
import { model as scanPhase } from '../scan-phase/model';
import { model as scanResult, type ScanResultShape } from '../scan-result/model';
import { model as scanState } from '../scan-state/model';

/**
 * The reconnect/fallback read (spec §"Scan progress": "`library.scanStatus`
 * stays as a query returning the same type... the fallback if Houdini's SSE
 * support proves awkward in spec 2") and the shape `libraryScan` (this task)
 * and `scanProgress` (task 9's subscription) both hand back. Carries the
 * whole `ScanJob` rather than cherry-picked primitives, the same way
 * `book-hash-collision-error/model.ts` carries the store's own error class —
 * every field below reads off `job` directly, so there is exactly one place
 * that ever re-shapes a `ScanJob` into wire fields.
 */
export type ScanStatusShape = {
  readonly owner: Owner;
  readonly job: ScanJob;
};

export const model = builder.objectRef<ScanStatusShape>('ScanStatus').implement({
  description: 'The state of a library scan — in progress, completed, or failed.',
  fields: (t) => ({
    // Renamed from `jobId` (design doc §1, spec 1's B4): a normalizing cache
    // keys on `id` by default — `Subscription.scanProgress`'s events could
    // not merge into `Library.scanStatus` under any other field name. Same
    // underlying value, `parent.job.jobId` (the scan-job store's own field
    // name, untouched — this is a GraphQL wire rename only).
    id: t.field({ type: 'ID', resolve: (parent) => parent.job.jobId }),
    state: t.field({ type: scanState, resolve: (parent) => parent.job.status }),
    phase: t.field({ type: scanPhase, resolve: (parent) => parent.job.phase }),
    total: t.int({ resolve: (parent) => parent.job.total }),
    processed: t.int({ resolve: (parent) => parent.job.processed }),
    currentFile: t.string({ nullable: true, resolve: (parent) => parent.job.currentFile }),
    startedAt: t.field({
      type: 'DateTime',
      resolve: (parent) => epochToDate(parent.job.startedAt),
    }),
    // Only ever non-null once the job has actually completed — a running or
    // failed job has no `ScanResult` to report. `job.result` is technically
    // optional independent of `status` in the store's own type, but the
    // store never sets one without the other (`reduceScanJob`'s `'complete'`
    // case sets both together), so this check is belt-and-braces, not a
    // second source of truth.
    result: t.field({
      type: scanResult,
      nullable: true,
      resolve: (parent): ScanResultShape | null =>
        parent.job.status === 'completed' && parent.job.result !== undefined
          ? {
              owner: parent.owner,
              importedBookIds: parent.job.importedBookIds,
              importedFilenames: parent.job.result.imported,
              removed: parent.job.result.removed,
            }
          : null,
    }),
    error: t.string({ nullable: true, resolve: (parent) => parent.job.error ?? null }),
  }),
});

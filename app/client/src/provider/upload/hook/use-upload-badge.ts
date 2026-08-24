import { usePendingFixes } from './use-pending-fixes';
import { useUploadQueue } from './use-upload-queue';

export type UploadBadge = { count: number; active: boolean };

/**
 * Nav-badge signal: `count` books have fixes awaiting a decision; `active`
 * is true while any upload is still running.
 *
 * `count` reads straight off `usePendingFixes()` — the SERVER's live
 * pending-fix rows — rather than the upload queue's merged `items`. Reading
 * off the queue was only ever correct once something had re-seeded it (an
 * upload completing, or `useUploadQueueEngine` mounting); right after a
 * reload, before either happens, the queue is empty and the badge would
 * under-report. The server row list carries the same count with no such
 * warm-up gap. A row counts only when `state.proposals` is non-empty: a row
 * can stay "live" (`isLivePendingFix`'s TTL) with `proposals: []` after a
 * resolution, armed only for `undo` — that is not a fix awaiting a
 * decision.
 *
 * `active` stays on `useUploadQueue()` (the transport-backed queue) — "an
 * upload is in flight" is knowledge only the client-side transport has; no
 * server read can answer it. This is why the hook keeps BOTH sources rather
 * than moving wholesale onto `usePendingFixes()`.
 */
export const useUploadBadge = (): UploadBadge => {
  const { rows } = usePendingFixes();
  const { items } = useUploadQueue();
  const count = rows.filter((r) => r.state.proposals.length > 0).length;
  const active = items.some((i) => i.status === 'queued' || i.status === 'uploading');
  return { count, active };
};

import type { ScanJob } from '../../../services/scan-events';
import type { Owner } from '../../../types';
import { builder } from '../builder';
import { model as scanStatus, type ScanStatusShape } from '../scan-status/model';
import { model as userError } from '../user-error';

/**
 * Mirrors REST's `POST /api/books/scan` 409 (`routes/ui.ts:1063-1066`):
 * `if (scanJobRegistry.isRunning(owner.userId)) { res.status(409).json
 * (scanJobRegistry.get(owner.userId)); return; }` — the response body IS the
 * already-running job. This type carries the same job (as `scanStatus`, the
 * same `ScanStatus` shape a success would have returned) rather than a bare
 * message, so a client can render live progress on the 409 exactly like it
 * would on a fresh `libraryScan` success, instead of discarding the
 * in-flight job's state.
 *
 * Not a store-thrown error (`toResult` is not involved): REST's 409 is a
 * precondition the route checks itself, before ever calling `bookStore.scan`
 * — same shape as `BookNotValidatedError`'s doc comment on why that error
 * also isn't a `toResult` discharge.
 */
export type ScanAlreadyRunningErrorShape = {
  readonly __typename: 'ScanAlreadyRunningError';
  readonly message: string;
  readonly owner: Owner;
  readonly job: ScanJob;
};

export const scanAlreadyRunningError = (
  owner: Owner,
  job: ScanJob
): ScanAlreadyRunningErrorShape => ({
  __typename: 'ScanAlreadyRunningError',
  message: 'A scan is already running for this library.',
  owner,
  job,
});

export const model = builder
  .objectRef<ScanAlreadyRunningErrorShape>('ScanAlreadyRunningError')
  .implement({
    description: 'A scan was already running for this library when this one was requested.',
    interfaces: [userError],
    fields: (t) => ({
      scanStatus: t.field({
        type: scanStatus,
        resolve: (parent): ScanStatusShape => ({ owner: parent.owner, job: parent.job }),
      }),
    }),
  });

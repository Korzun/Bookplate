import { randomUUID } from 'crypto';

import {
  reduceScanJob,
  type ScanEvent,
  type ScanJob,
  type ScanProgress,
  type ScanResult,
} from './scan-events';

// Re-exported for backward compatibility: `ScanJob`/`ScanResult`/`ScanJobStatus`
// used to be defined in this file directly. They now live in `scan-events.ts`
// (the pure module the class below delegates to) — nothing outside this file
// imports the type from here today, but re-exporting keeps the public surface
// stable rather than silently moving it.
export type { ScanJob, ScanJobStatus, ScanResult } from './scan-events';

/**
 * In-memory, per-user scan job tracking. State is intentionally not persisted:
 * scans are user-triggered and cheap to re-run, so losing job state on restart
 * is acceptable. One job per user; starting a new one replaces any prior job.
 *
 * The class itself stays a class (spec's explicit exception for existing
 * store code) — but every state transition after `start()` folds through
 * `reduceScanJob` (`scan-events.ts`) rather than mutating a `ScanJob` in
 * place, so the state machine itself is tested as a pure function, not
 * through this `Map`-and-wall-clock holder. `start()` is NOT one of those
 * delegated transitions: it mints the job's identity (`jobId`, `startedAt`)
 * fresh, with no prior job to fold onto — see `reduceScanJob`'s doc comment.
 */
export class ScanJobStore {
  private readonly jobs = new Map<string, ScanJob>();

  start(userId: string): ScanJob {
    const job: ScanJob = {
      jobId: randomUUID(),
      status: 'running',
      startedAt: Date.now(),
      total: 0,
      processed: 0,
      phase: 'importing',
      currentFile: null,
      importedBookIds: [],
    };
    this.jobs.set(userId, job);
    return job;
  }

  /**
   * The `onProgress` callback `BookStore.scan()` is handed (via `libraryScan`,
   * task 8) calls this once per branch point the scan loop already hits. A
   * no-op when no job is tracked for `userId` — mirrors `complete`/`fail`
   * below, and protects against a stray progress event outliving its job
   * (e.g. a caller that never called `start`).
   *
   * Does NOT publish to a pubsub: `shouldPublish`'s predicate and the actual
   * `createPubSub()` wiring are task 9's — this only keeps the job's own
   * state current, which `Library.scanStatus` (also task 9) will read.
   */
  progress(userId: string, progress: ScanProgress): void {
    this.apply(userId, { type: 'progress', progress });
  }

  complete(userId: string, result: ScanResult): void {
    this.apply(userId, { type: 'complete', result });
  }

  fail(userId: string, error: string): void {
    this.apply(userId, { type: 'fail', error });
  }

  private apply(userId: string, event: ScanEvent): void {
    const job = this.jobs.get(userId);
    if (job === undefined) return;
    this.jobs.set(userId, reduceScanJob(job, event));
  }

  get(userId: string): ScanJob | undefined {
    return this.jobs.get(userId);
  }

  isRunning(userId: string): boolean {
    return this.jobs.get(userId)?.status === 'running';
  }
}

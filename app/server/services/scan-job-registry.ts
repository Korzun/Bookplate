import { randomUUID } from 'crypto';

import {
  reduceScanJob,
  shouldPublish,
  type ScanEvent,
  type ScanJob,
  type ScanProgress,
  type ScanResult,
} from './scan-events';
import { noopScanPublisher, type ScanPublisher } from './scan-publisher';

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
 *
 * Task 9 adds the publishing half: spec §"Scan progress"/"ScanJobRegistry" — "a
 * yoga `createPubSub()` publishing on a per-user topic from all four
 * transition points (`start`, `progress`, `complete`, `fail`)". At the time,
 * `ScanJobRegistry` was the one shared instance both `POST /api/books/scan`
 * (`routes/ui.ts`) and `libraryScan`/`scanProgress` traversed, so publishing
 * here, not in the GraphQL mutation's `onProgress` callback, was what made a
 * REST-started scan visible over the subscription at all: REST's own call
 * site passed no `onProgress`, so it only ever reached this class through
 * `start`/`complete`/`fail`.
 *
 * REST's `/api/books/scan` route was removed along with the rest of the
 * REST surface GraphQL replaced (the commit that dropped `BookStore`'s
 * production callers), and `index.ts` no longer threads `ScanJobRegistry` into
 * `createServer`/`createUiRouter` — GraphQL's `libraryScan` is this class's
 * only caller today. Publishing still lives here rather than inlined into
 * the mutation, since this remains the one place all four transition points
 * are guaranteed to go through.
 *
 * The publisher this class talks to is `ScanPublisher` (`scan-publisher.ts`),
 * a structural contract declared here in `services/` — NOT `graphql/
 * pubsub.ts`'s concrete type. Review (task 9, I-1): the first version of this
 * class imported `graphql/pubsub.ts` directly, making this the codebase's
 * only `services/` file depending on `graphql/`. `graphql/pubsub.ts`'s
 * `ScanPubSub` satisfies `ScanPublisher` structurally, so `index.ts`/
 * `graphql/test-util.ts` inject the exact same real instance as before —
 * only the declared dependency direction changed.
 */
export class ScanJobRegistry {
  private readonly jobs = new Map<string, ScanJob>();

  /**
   * The wall-clock timestamp (`Date.now()`) of the last publish actually sent
   * for a user's current job — the `lastPublishedAt` `shouldPublish`
   * (`scan-events.ts`) compares `now` against. Keyed by `userId`, same as
   * `jobs`; reset (via `start`'s own unconditional publish, below) at the
   * start of every job rather than carried over from a prior one.
   */
  private readonly lastPublishedAt = new Map<string, number>();

  /**
   * Defaults to `noopScanPublisher` so every pre-task-9 caller
   * (`routes/ui.test.ts`, `scan-job-registry.test.ts`'s many `new ScanJobRegistry()`
   * call sites) keeps compiling and passing unmodified — a genuine no-op, not
   * merely a real pubsub nobody happens to subscribe to. Production
   * (`index.ts`) and the GraphQL test harness (`graphql/test-util.ts`) both
   * pass the same real `ScanPubSub` instance a subscription resolver also
   * reads from.
   */
  constructor(private readonly publisher: ScanPublisher = noopScanPublisher) {}

  start(userId: string): ScanJob {
    const now = Date.now();
    const job: ScanJob = {
      jobId: randomUUID(),
      status: 'running',
      startedAt: now,
      total: 0,
      processed: 0,
      phase: 'importing',
      currentFile: null,
      importedBookIds: [],
    };
    this.jobs.set(userId, job);
    // Not one of `reduceScanJob`'s three `ScanEvent`s (see the class doc
    // comment), so it never goes through `shouldPublish` either — a fresh job
    // starting is always worth telling a subscriber about immediately, the
    // same "always" `shouldPublish` already gives terminal events, and there
    // is exactly one `start` per job, so this can never itself become the
    // flood the coalescing rule exists to prevent.
    this.lastPublishedAt.set(userId, now);
    this.publisher.publish('scan', userId, job);
    return job;
  }

  /**
   * The `onProgress` callback `scan()` (`services/book-lifecycle.ts`) is
   * handed (via `libraryScan`, task 8) calls this once per branch point the
   * scan loop already hits. A
   * no-op when no job is tracked for `userId` — mirrors `complete`/`fail`
   * below, and protects against a stray progress event outliving its job
   * (e.g. a caller that never called `start`).
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

  /**
   * Folds `event` onto the tracked job via `reduceScanJob`, then publishes the
   * new job exactly when `shouldPublish` (`scan-events.ts`) says to — the
   * 250ms coalesce for `'progress'`, always for the terminal `'complete'`/
   * `'fail'` events. `lastPublishedAt` only advances on an actual publish, not
   * on every fold, so a coalesced-away `'progress'` event doesn't push the
   * window out further than the last real publish already did.
   */
  private apply(userId: string, event: ScanEvent): void {
    const job = this.jobs.get(userId);
    if (job === undefined) return;
    const next = reduceScanJob(job, event);
    this.jobs.set(userId, next);

    const now = Date.now();
    if (shouldPublish(this.lastPublishedAt.get(userId) ?? 0, now, event)) {
      this.lastPublishedAt.set(userId, now);
      this.publisher.publish('scan', userId, next);
    }
  }

  get(userId: string): ScanJob | undefined {
    return this.jobs.get(userId);
  }

  isRunning(userId: string): boolean {
    return this.jobs.get(userId)?.status === 'running';
  }

  /**
   * The subscription side of the same per-user topic `start`/`progress`/
   * `complete`/`fail` publish onto — `Subscription.scanProgress`
   * (`graphql/schema/library/subscription/scan-progress.ts`) is the only
   * caller, and reaches this rather than the underlying publisher directly so
   * every access to scan state — publish AND subscribe — goes through this
   * one class.
   */
  subscribe(userId: string): AsyncIterable<ScanJob> {
    return this.publisher.subscribe('scan', userId);
  }
}

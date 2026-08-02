/**
 * Pure state machine for `ScanJobStore`: the per-file/per-row events
 * `BookStore.scan()`'s `onProgress` callback raises, the job shape they fold
 * into, and the coalescing rule that decides which folds are worth
 * publishing. Nothing here touches the database, the filesystem, a wall
 * clock, or `Map` state — `ScanJobStore` (a class, by explicit spec
 * exception) is the only thing that owns those, and it delegates every state
 * transition to `reduceScanJob` below rather than mutating a `ScanJob` in
 * place. See the GraphQL server design spec, §"Scan progress" / "ScanJobStore".
 */

/**
 * One update `BookStore.scan()`'s `onProgress` callback raises at a point the
 * loop already branches on — spec §"Scan progress", binding shape.
 *
 * `scan()` has two countable phases, each with its own total known before the
 * phase's loop starts: an import pass over `diskFilenames`, and a prune pass
 * over the DB rows already on file. `bookId` rides along on an `'imported'`
 * outcome because the import loop has already computed it (the freshly
 * inserted row's id), letting a subscriber resolve the entry to a real `Book`
 * without a second lookup — see `ScanResult.imported` in `graphql/schema/
 * scan-status/model.ts`. It is optional on `'importing'` because a
 * `'skipped'` outcome from the loop's very first branch point (a parse
 * failure) has no id to report at all.
 */
export type ScanProgress =
  | {
      phase: 'importing';
      total: number;
      processed: number;
      filename: string;
      outcome: 'imported' | 'renamed' | 'already-imported' | 'skipped';
      bookId?: string;
    }
  | { phase: 'pruning'; total: number; processed: number; bookId: string };

/** `BookStore.scan()`'s own return shape — unchanged by this task, spec §"Scan progress". */
export type ScanResult = { imported: string[]; removed: string[] };

export type ScanJobStatus = 'running' | 'completed' | 'failed';

export type ScanPhase = ScanProgress['phase'];

/**
 * Gains `total`, `processed`, `phase`, `currentFile` and `importedBookIds`
 * over the pre-task-8 shape (spec: "Gains `total`, `processed`, `phase` and
 * `currentFile` on `ScanJob`"). `importedBookIds` is this task's own
 * addition, not named in the spec's prose list: it is what makes
 * `ScanResult.imported: [Book!]!` (the SDL the spec's own snippet declares)
 * resolvable at all — `ScanResult`'s two other fields
 * (`importedFilenames`/`removed`) come straight off `ScanResult` the store
 * returns, but that shape carries no ids, only filenames, and a filename
 * cannot back a `Book` lookup once the loop has possibly renamed the file out
 * of the id it should have been imported at. Accumulated once per
 * `'imported'`-outcome progress event (never touched by `'renamed'` — a book
 * that already existed is not newly imported, nor by `'already-imported'`/
 * `'skipped'` for the same reason), so it is available the moment `complete`
 * fires without a second pass over the result.
 */
export type ScanJob = {
  jobId: string;
  status: ScanJobStatus;
  startedAt: number;
  total: number;
  processed: number;
  phase: ScanPhase;
  currentFile: string | null;
  importedBookIds: string[];
  result?: ScanResult;
  error?: string;
};

/**
 * The three transitions `ScanJobStore` folds into a running `ScanJob`.
 * Starting a job is deliberately NOT one of these: it mints a fresh `jobId`/
 * `startedAt` and has no prior job to fold onto (`ScanJobStore.start()`
 * constructs the initial `ScanJob` directly, the same way the pre-task-8 code
 * did) — `reduceScanJob` only ever evolves a job that already exists.
 */
export type ScanEvent =
  | { type: 'progress'; progress: ScanProgress }
  | { type: 'complete'; result: ScanResult }
  | { type: 'fail'; error: string };

/**
 * Folds one `ScanEvent` onto a `ScanJob`, returning a new job — no mutation.
 * Replaces the pre-task-8 in-place assignments (`job.status = 'completed'`,
 * `job.result = result`) the class used to do directly; see
 * `ScanJobStore.complete`/`fail`/`progress`, which now call this instead.
 *
 * A `'progress'` event overwrites `total`/`processed`/`phase`/`currentFile`
 * with whatever the just-fired `ScanProgress` says — both phases carry their
 * own total/processed pair (spec: "two countable phases"), so there is
 * nothing to merge across phases, only to replace. `currentFile` is the
 * progress event's `filename` during `'importing'` and `null` during
 * `'pruning'` (a DB row has no "current file" — see `ScanProgress`'s own doc
 * comment on why `'pruning'` carries `bookId` instead).
 */
export const reduceScanJob = (job: ScanJob, event: ScanEvent): ScanJob => {
  switch (event.type) {
    case 'progress': {
      const { progress } = event;
      const isNewImport =
        progress.phase === 'importing' &&
        progress.outcome === 'imported' &&
        progress.bookId !== undefined;
      return {
        ...job,
        total: progress.total,
        processed: progress.processed,
        phase: progress.phase,
        currentFile: progress.phase === 'importing' ? progress.filename : null,
        importedBookIds: isNewImport
          ? [...job.importedBookIds, progress.bookId as string]
          : job.importedBookIds,
      };
    }
    case 'complete':
      return { ...job, status: 'completed', result: event.result };
    case 'fail':
      return { ...job, status: 'failed', error: event.error };
  }
};

/** The coalescing window — spec §"Coalescing is required": "at most once per 250ms". */
export const SCAN_PUBLISH_COALESCE_MS = 250;

/**
 * Whether a `ScanJobStore` publish (a future yoga `pubsub.publish`, wired in
 * task 9) should actually happen for `event`, given when the last one went
 * out (`lastPublishedAt`) and the current time (`now`).
 *
 * Terminal events (`'complete'`/`'fail'`) ALWAYS publish, unconditionally —
 * a client must learn a scan finished even if it landed inside a coalescing
 * window, and there is exactly one terminal event per job, so this can never
 * itself become the flood the coalescing exists to prevent. A `'progress'`
 * event publishes only once `now - lastPublishedAt` has reached the window,
 * so a large library that races through thousands of already-canonical files
 * in milliseconds (spec §"Coalescing is required") publishes at most once
 * per `SCAN_PUBLISH_COALESCE_MS`, not once per file.
 *
 * Pure and clock-free by construction: `now`/`lastPublishedAt` are plain
 * numbers the caller supplies, never read from `Date.now()` in here — this is
 * what lets the predicate be tested against a table of inputs with no fake
 * timers (see `scan-events.test.ts`).
 */
export const shouldPublish = (lastPublishedAt: number, now: number, event: ScanEvent): boolean => {
  if (event.type !== 'progress') return true;
  return now - lastPublishedAt >= SCAN_PUBLISH_COALESCE_MS;
};

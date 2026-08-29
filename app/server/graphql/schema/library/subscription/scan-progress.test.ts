import { parse, subscribe, type ExecutionResult } from 'graphql';

import type { Context, Viewer } from '../../../context';
import { createHarness, type Harness } from '../../../test-util';
import { schema } from '../../index';

vi.mock('../../../../logger');

let harness: Harness;
let aliceLibraryGlobalId: string;

beforeEach(async () => {
  harness = await createHarness();
  aliceLibraryGlobalId = await harness.seedNodeFor('Library');
});

afterEach(async () => {
  await harness.cleanup();
});

const DOCUMENT = parse(`
  subscription ($libraryId: ID!) {
    scanProgress(libraryId: $libraryId) {
      id
      state
      phase
      total
      processed
      currentFile
    }
  }
`);

// The harness's own builder — see `Harness.contextFor`. This used to be a
// hand-rolled near-copy that had fallen three fields behind the real `Context`.
const contextFor = (viewer: Viewer | null): Context => harness.contextFor(viewer);

/**
 * Narrows `subscribe()`'s `AsyncGenerator | ExecutionResult` return to the
 * iterator. The obvious `if ('errors' in result) throw` guard does NOT narrow
 * the negative branch: `ExecutionResult.errors` is OPTIONAL, so TypeScript
 * must keep that member in the union even after the check, and every
 * `.next()`/`.return()` below was an error once test files started being
 * type-checked. Testing for the async-iterator symbol discriminates properly,
 * and still throws the same diagnostic the old guard did.
 */
const asIterator = (
  result: AsyncGenerator<ExecutionResult, void, void> | ExecutionResult
): AsyncGenerator<ExecutionResult, void, void> => {
  if (!(Symbol.asyncIterator in result)) {
    throw new Error(`expected an async iterator, got errors: ${JSON.stringify(result.errors)}`);
  }
  return result;
};

type ScanProgressData = {
  scanProgress: {
    id: string;
    state: string;
    phase: string;
    total: number;
    processed: number;
    currentFile: string | null;
  };
};

// Takes the iterator result directly: `IteratorResult`'s return-case `value`
// is `void`, so the looser `{ value?: { data?: unknown } }` this used to
// declare does not accept what `stream.next()` actually hands back.
const dataOf = (result: IteratorResult<ExecutionResult, void>): ScanProgressData =>
  (result.value as ExecutionResult | undefined)?.data as ScanProgressData;

// Real, not fake, timers throughout this file — `ScanJobRegistry.apply` reads
// `Date.now()` directly (`services/scan-job-registry.ts`), and every wait here
// either (a) lets the `subscribe` field's own `await context.loadOwner(...)`
// (a real sqlite round trip) reach the `for await` that registers the
// underlying pubsub listener before the triggering registry call fires, or (b)
// clears the 250ms coalescing window `shouldPublish` (services/scan-events.ts)
// enforces — same real-timer tolerance `library/mutation/scan.test.ts`'s
// `waitForScanSettled` already uses for a comparable async race.
const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('Subscription.scanProgress', () => {
  it('streams start, progress and a terminal event, in order, for the viewer’s own library', async () => {
    const result = await subscribe({
      schema,
      document: DOCUMENT,
      variableValues: { libraryId: aliceLibraryGlobalId },
      contextValue: contextFor(harness.aliceViewer),
    });
    const stream = asIterator(result);

    const startEvent = stream.next();
    await settle(50);
    const started = harness.scanJobs.start(harness.aliceOwner.userId);
    const first = dataOf(await startEvent);
    expect(first.scanProgress.id).toBe(started.jobId);
    expect(first.scanProgress.state).toBe('RUNNING');
    expect(first.scanProgress.phase).toBe('IMPORTING');
    expect(first.scanProgress.total).toBe(0);

    const progressEvent = stream.next();
    await settle(300);
    harness.scanJobs.progress(harness.aliceOwner.userId, {
      phase: 'importing',
      total: 2,
      processed: 1,
      filename: 'a.epub',
      outcome: 'imported',
      bookId: 'b1',
    });
    const second = dataOf(await progressEvent);
    expect(second.scanProgress.total).toBe(2);
    expect(second.scanProgress.processed).toBe(1);
    expect(second.scanProgress.currentFile).toBe('a.epub');

    const terminalEvent = stream.next();
    harness.scanJobs.complete(harness.aliceOwner.userId, {
      imported: ['a.epub'],
      removed: [],
    });
    const third = dataOf(await terminalEvent);
    expect(third.scanProgress.state).toBe('COMPLETED');
    expect(third.scanProgress.id).toBe(started.jobId);

    await stream.return();
  });

  /**
   * `ownerOf` on the DECODED id (`args.libraryId.id`) — seen-to-fail pair
   * with the test above: if `args.libraryId.id` arrived as the raw base64
   * global-id string instead (the failure mode `builder.ts`'s "RelayPlugin
   * before ScopeAuthPlugin" ordering comment exists to prevent), the test
   * above would ALSO fail — a raw string never equals a real userId, so even
   * alice's own subscription would be denied. That test passing is therefore
   * real, not assumed, evidence the id decodes before `ownerOf` runs; this
   * test is the matching negative control.
   */
  it('refuses a cross-tenant subscription — denied before any event is ever observed', async () => {
    const result = await subscribe({
      schema,
      document: DOCUMENT,
      variableValues: { libraryId: aliceLibraryGlobalId },
      contextValue: contextFor(harness.bobViewer),
    });

    expect('errors' in result).toBe(true);
    const errors = 'errors' in result ? result.errors : undefined;
    expect(errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  /**
   * Review (task 9, M-1): the topic `scanProgress`'s `subscribe` generator
   * reads from is derived from the DECODED `libraryId`'s owner
   * (`context.loadOwner(args.libraryId.id).userId`), never from
   * `context.viewer`. The admin's own `userId` is `null`
   * (`test-util.ts`'s `adminViewer`) — a viewer-derived topic would be
   * `scan:null`, and this subscription could never receive alice's event at
   * all, so establishing a working stream already discriminates the
   * derivation. Asserting `id` (not just `state`) pins CONTENTS, matching
   * the same discipline `scan-status.test.ts`'s admin-traversal row applies.
   */
  it('lets an admin subscribe to a named user’s library, receiving that user’s real job', async () => {
    const result = await subscribe({
      schema,
      document: DOCUMENT,
      variableValues: { libraryId: aliceLibraryGlobalId },
      contextValue: contextFor(harness.adminViewer),
    });
    const stream = asIterator(result);

    const startEvent = stream.next();
    await settle(50);
    const started = harness.scanJobs.start(harness.aliceOwner.userId);
    const first = dataOf(await startEvent);
    expect(first.scanProgress.id).toBe(started.jobId);
    expect(first.scanProgress.state).toBe('RUNNING');

    await stream.return();
  });

  /**
   * The M-5 ruling (task 8 review, carried into this task's brief): REST's
   * own `POST /api/books/scan` (since removed along with the rest of the
   * REST surface GraphQL replaced) used to call `bookStore.scan(owner)` with
   * no `onProgress`, so a REST-started scan only ever reached `ScanJobRegistry`
   * through `start`/`complete`/`fail` — never `progress`. This test drives
   * `ScanJobRegistry` directly, the same calls that REST route used to make (not
   * through `libraryScan`), and asserts the subscription still observes
   * those transitions — proving a caller that never wires `onProgress`
   * remains visible over `scanProgress`, at start/terminal granularity.
   */
  it('is visible over the subscription at start/terminal granularity when driven directly, with no onProgress wired', async () => {
    const result = await subscribe({
      schema,
      document: DOCUMENT,
      variableValues: { libraryId: aliceLibraryGlobalId },
      contextValue: contextFor(harness.aliceViewer),
    });
    const stream = asIterator(result);

    const startEvent = stream.next();
    await settle(50);
    // Mirrors the old REST route's call shape exactly: `bookStore.scan(owner)`
    // with no `onProgress` third argument, so the only registry calls a REST
    // scan ever made were `start` and (via the detached pipeline) `complete`/`fail`.
    const started = harness.scanJobs.start(harness.aliceOwner.userId);
    const first = dataOf(await startEvent);
    expect(first.scanProgress.id).toBe(started.jobId);
    expect(first.scanProgress.state).toBe('RUNNING');

    const terminalEvent = stream.next();
    harness.scanJobs.complete(harness.aliceOwner.userId, {
      imported: ['found.epub'],
      removed: [],
    });
    const second = dataOf(await terminalEvent);
    expect(second.scanProgress.state).toBe('COMPLETED');
    expect(second.scanProgress.id).toBe(started.jobId);

    await stream.return();
  });
});

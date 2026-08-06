import { parse, subscribe } from 'graphql';

import { createChapterSpineMapLoader } from '../../../chapter-spine-map-loader';
import type { Context, Viewer } from '../../../context';
import { createOwnerLoader } from '../../../owner';
import { createPendingFixLoader } from '../../../pending-fix-loader';
import { createProgressLoader } from '../../../progress-loader';
import { createSeriesProgressLoader } from '../../../series-progress-loader';
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

const contextFor = (viewer: Viewer | null): Context => ({
  viewer,
  prisma: harness.prisma,
  stores: harness.stores,
  config: harness.config,
  loadOwner: createOwnerLoader(harness.prisma),
  loadProgress: createProgressLoader(harness.prisma),
  loadPendingFix: createPendingFixLoader(harness.prisma),
  loadChapterSpineMap: createChapterSpineMapLoader(harness.prisma),
  loadSeriesProgress: createSeriesProgressLoader(harness.prisma),
});

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

const dataOf = (result: { value?: { data?: unknown } }): ScanProgressData =>
  result.value?.data as ScanProgressData;

// Real, not fake, timers throughout this file — `ScanJobStore.apply` reads
// `Date.now()` directly (`services/scan-job-store.ts`), and every wait here
// either (a) lets the `subscribe` field's own `await context.loadOwner(...)`
// (a real sqlite round trip) reach the `for await` that registers the
// underlying pubsub listener before the triggering store call fires, or (b)
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
    if ('errors' in result) {
      throw new Error(`expected an async iterator, got errors: ${JSON.stringify(result.errors)}`);
    }

    const startEvent = result.next();
    await settle(50);
    const started = harness.stores.scanJob.start(harness.aliceOwner.userId);
    const first = dataOf(await startEvent);
    expect(first.scanProgress.id).toBe(started.jobId);
    expect(first.scanProgress.state).toBe('RUNNING');
    expect(first.scanProgress.phase).toBe('IMPORTING');
    expect(first.scanProgress.total).toBe(0);

    const progressEvent = result.next();
    await settle(300);
    harness.stores.scanJob.progress(harness.aliceOwner.userId, {
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

    const terminalEvent = result.next();
    harness.stores.scanJob.complete(harness.aliceOwner.userId, {
      imported: ['a.epub'],
      removed: [],
    });
    const third = dataOf(await terminalEvent);
    expect(third.scanProgress.state).toBe('COMPLETED');
    expect(third.scanProgress.id).toBe(started.jobId);

    await result.return?.();
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
    if ('errors' in result) {
      throw new Error(`expected an async iterator, got errors: ${JSON.stringify(result.errors)}`);
    }

    const startEvent = result.next();
    await settle(50);
    const started = harness.stores.scanJob.start(harness.aliceOwner.userId);
    const first = dataOf(await startEvent);
    expect(first.scanProgress.id).toBe(started.jobId);
    expect(first.scanProgress.state).toBe('RUNNING');

    await result.return?.();
  });

  /**
   * The M-5 ruling (task 8 review, carried into this task's brief): REST's
   * own `POST /api/books/scan` (`routes/ui.ts:1071`) calls
   * `bookStore.scan(owner)` with no `onProgress`, so a REST-started scan only
   * ever reaches `ScanJobStore` through `start`/`complete`/`fail` — never
   * `progress`. This test drives the shared store DIRECTLY, the same calls
   * REST's own route makes (not through `libraryScan`, and with no
   * `routes/ui.ts` edit), and asserts the subscription still observes those
   * transitions — proving REST-initiated scans are visible over
   * `scanProgress`, at start/terminal granularity, without needing to touch
   * `routes/` at all.
   */
  it('is visible over the subscription at start/terminal granularity when driven the way REST drives it', async () => {
    const result = await subscribe({
      schema,
      document: DOCUMENT,
      variableValues: { libraryId: aliceLibraryGlobalId },
      contextValue: contextFor(harness.aliceViewer),
    });
    if ('errors' in result) {
      throw new Error(`expected an async iterator, got errors: ${JSON.stringify(result.errors)}`);
    }

    const startEvent = result.next();
    await settle(50);
    // Mirrors `routes/ui.ts`'s own call shape exactly: `bookStore.scan(owner)`
    // with no `onProgress` third argument, so the only store calls a REST scan
    // ever makes are `start` and (via the detached pipeline) `complete`/`fail`.
    const started = harness.stores.scanJob.start(harness.aliceOwner.userId);
    const first = dataOf(await startEvent);
    expect(first.scanProgress.id).toBe(started.jobId);
    expect(first.scanProgress.state).toBe('RUNNING');

    const terminalEvent = result.next();
    harness.stores.scanJob.complete(harness.aliceOwner.userId, {
      imported: ['found.epub'],
      removed: [],
    });
    const second = dataOf(await terminalEvent);
    expect(second.scanProgress.state).toBe('COMPLETED');
    expect(second.scanProgress.id).toBe(started.jobId);

    await result.return?.();
  });
});

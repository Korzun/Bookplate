import type { ScanJob } from '../services/scan-events';
import { createScanPubSub } from './pubsub';

const job = (jobId: string): ScanJob => ({
  jobId,
  status: 'running',
  startedAt: 0,
  total: 0,
  processed: 0,
  phase: 'importing',
  currentFile: null,
  importedBookIds: [],
});

// Direct coverage of the one primitive `ScanJobStore` (services/scan-job-store.ts)
// builds its publish/subscribe methods on top of — see that file's own tests
// for the store-level behaviour (coalescing, per-user isolation via `start`/
// `progress`/`complete`/`fail`) this module doesn't duplicate.
describe('createScanPubSub', () => {
  it('delivers a published job to a subscriber on the same userId topic', async () => {
    const pubsub = createScanPubSub();
    const iterator = pubsub.subscribe('scan', 'u1')[Symbol.asyncIterator]();

    const pending = iterator.next();
    pubsub.publish('scan', 'u1', job('j1'));

    const { value, done } = await pending;
    expect(done).toBe(false);
    expect(value).toEqual(job('j1'));

    await iterator.return?.();
  });

  it('never delivers a userId’s publish to a different userId’s subscriber — the per-user topic isolation `scan:${userId}` exists for', async () => {
    const pubsub = createScanPubSub();
    const aliceIterator = pubsub.subscribe('scan', 'alice')[Symbol.asyncIterator]();
    const bobIterator = pubsub.subscribe('scan', 'bob')[Symbol.asyncIterator]();

    const alicePending = aliceIterator.next();
    const bobPending = bobIterator.next();
    pubsub.publish('scan', 'alice', job('alice-job'));

    const aliceResult = await alicePending;
    expect(aliceResult.value).toEqual(job('alice-job'));

    // Bob's iterator must still be unresolved — prove it with a race against
    // a resolved sentinel rather than a fixed sleep.
    const sentinel = Symbol('timeout');
    const raced = await Promise.race([
      bobPending,
      new Promise((resolve) => setTimeout(() => resolve(sentinel), 20)),
    ]);
    expect(raced).toBe(sentinel);

    await aliceIterator.return?.();
    await bobIterator.return?.();
  });
});

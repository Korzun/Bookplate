import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const QUERY = `
  query {
    viewer { library { scanStatus {
      id state phase total processed currentFile startedAt error
      result { importedFilenames removed imported { id } }
    } } }
  }
`;

describe('Library.scanStatus', () => {
  it('is null when no scan has ever run for this library', async () => {
    const result = await harness.execute(QUERY, { viewer: harness.aliceViewer });
    expect(result.errors).toBeUndefined();
    expect(result.data?.viewer).toEqual({ library: { scanStatus: null } });
  });

  it('reflects the current job while a scan is running — the reconnect path spec §"Scan progress" describes', async () => {
    const job = harness.scanJobs.start(harness.aliceOwner.userId);
    harness.scanJobs.progress(harness.aliceOwner.userId, {
      phase: 'importing',
      total: 3,
      processed: 1,
      filename: 'a.epub',
      outcome: 'imported',
      bookId: 'b1',
    });

    const result = await harness.execute(QUERY, { viewer: harness.aliceViewer });
    expect(result.errors).toBeUndefined();
    const data = result.data as {
      viewer: {
        library: {
          scanStatus: {
            id: string;
            state: string;
            phase: string;
            total: number;
            processed: number;
            currentFile: string | null;
            result: unknown;
          };
        };
      };
    };
    expect(data.viewer.library.scanStatus.id).toBe(job.jobId);
    expect(data.viewer.library.scanStatus.state).toBe('RUNNING');
    expect(data.viewer.library.scanStatus.phase).toBe('IMPORTING');
    expect(data.viewer.library.scanStatus.total).toBe(3);
    expect(data.viewer.library.scanStatus.processed).toBe(1);
    expect(data.viewer.library.scanStatus.currentFile).toBe('a.epub');
    expect(data.viewer.library.scanStatus.result).toBeNull();
  });

  it('reflects a completed job', async () => {
    harness.scanJobs.start(harness.aliceOwner.userId);
    harness.scanJobs.complete(harness.aliceOwner.userId, {
      imported: ['a.epub'],
      removed: [],
    });

    const result = await harness.execute(QUERY, { viewer: harness.aliceViewer });
    expect(result.errors).toBeUndefined();
    const data = result.data as {
      viewer: {
        library: { scanStatus: { state: string; result: { importedFilenames: string[] } } };
      };
    };
    expect(data.viewer.library.scanStatus.state).toBe('COMPLETED');
    expect(data.viewer.library.scanStatus.result.importedFilenames).toEqual(['a.epub']);
  });

  it('does not leak another user’s scan status — cross-tenant, victim state unchanged', async () => {
    const job = harness.scanJobs.start(harness.bobOwner.userId);

    const result = await harness.execute(QUERY, { viewer: harness.aliceViewer });
    expect(result.errors).toBeUndefined();
    expect(result.data?.viewer).toEqual({ library: { scanStatus: null } });
    // Victim state unchanged — the read did not disturb bob's own job.
    expect(harness.scanJobs.get(harness.bobOwner.userId)?.jobId).toBe(job.jobId);
  });

  /**
   * Review (task 9, I-2): every case above reads through `viewer { library }`,
   * so `owner` is alice reading her own library — `owner.userId` and
   * `context.viewer.userId` are the same value in every one of them, which
   * cannot discriminate "the resolver reads `owner` off its `Library` parent"
   * from "the resolver re-derives the owner from the viewer instead" (the
   * standing rule: "a self-read cannot discriminate owner-derivation;
   * admin-traversal asserts CONTENTS"). The admin's own `userId` is `null`
   * (`test-util.ts`'s `adminViewer`), so a viewer-derived implementation would
   * read `scanJob.get(null)` here and return `null` even though alice's job
   * exists — this test would fail red against that bug. Asserts `id`
   * (CONTENTS), not just non-null.
   */
  it('resolves through Query.user(id:).library as the admin, asserting CONTENTS not just presence', async () => {
    const job = harness.scanJobs.start(harness.aliceOwner.userId);

    const result = await harness.execute(
      `query ($id: ID!) { user(id: $id) { library { scanStatus { id state } } } }`,
      { viewer: harness.adminViewer, variables: { id: harness.aliceGlobalId } }
    );

    expect(result.errors).toBeUndefined();
    const data = result.data as {
      user: { library: { scanStatus: { id: string; state: string } } };
    };
    expect(data.user.library.scanStatus.id).toBe(job.jobId);
    expect(data.user.library.scanStatus.state).toBe('RUNNING');
  });

  // Schema-level assertion: `jobId` is GONE, not merely superseded by `id`
  // returning the same value under a different name.
  it('rejects the old field name — jobId no longer exists on ScanStatus', async () => {
    const result = await harness.execute('{ viewer { library { scanStatus { jobId } } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.data).toBeUndefined();
    expect(result.errors?.length).toBeGreaterThan(0);
    expect(result.errors?.[0]?.message).toMatch(/jobId/i);
  });
});

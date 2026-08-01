import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = '1'.repeat(32);

// A genuinely-pending fix: `getPendingFixes` (book-store.ts) treats a row
// with no proposals and no undo as already resolved and deletes it on read,
// so an empty `proposals` array would make `Library.pendingFixes` correctly
// return `[]` — starving the "lists" test below of any row to find, even
// though `Book.pendingFix` (a raw relation, no such cleanup) would still see
// it. A non-empty `proposals` array keeps the fixture "pending" under both
// readings.
const PROPOSAL = {
  field: 'title',
  kind: 'replace',
  from: 'Old Title',
  to: 'New Title',
  changes: {},
};
const SEEDED_STATE_JSON = JSON.stringify({ proposals: [PROPOSAL] });

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: BOOK_ID,
      title: 'Needs Fixing',
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.pendingFix.create({
    data: {
      userId: harness.aliceOwner.userId,
      bookId: BOOK_ID,
      fileName: 'needs-fixing.epub',
      fileSize: 2048,
      state: SEEDED_STATE_JSON,
      updatedAt: 1_700_000_000_000,
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

describe('PendingFix', () => {
  it('exposes a pending fix on its book', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { pendingFix { fileName fileSize state } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const pendingFix = (
      result.data as {
        viewer: {
          library: { book: { pendingFix: { fileName: string; fileSize: number; state: string } } };
        };
      }
    ).viewer.library.book.pendingFix;
    expect(pendingFix).toMatchObject({ fileName: 'needs-fixing.epub', fileSize: 2048 });
    // `Book.pendingFix.state` is the raw stored column, verbatim — parsing it
    // yields exactly what was written, no defaulting/normalization applied.
    expect(JSON.parse(pendingFix.state)).toEqual({ proposals: [PROPOSAL] });
  });

  it('lists the library pending fixes', async () => {
    const result = await harness.execute(
      '{ viewer { library { pendingFixes { fileName state } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const pendingFixes = (
      result.data as {
        viewer: { library: { pendingFixes: { fileName: string; state: string }[] } };
      }
    ).viewer.library.pendingFixes;
    expect(pendingFixes).toHaveLength(1);
    expect(pendingFixes[0]?.fileName).toBe('needs-fixing.epub');
    // `Library.pendingFixes[].state` is reconstructed from the DTO
    // `getPendingFixes` already shaped (book-store.ts) — normalized with the
    // same defaults REST's `/api/books/pending-fixes` applies (missing
    // `autoFixes`/`appliedFixes` default to `[]`, missing `undo` defaults to
    // `null`) — but parses to the same `proposals` content as the raw column
    // above, confirming the two readings agree on what `state` means.
    expect(JSON.parse(pendingFixes[0]?.state ?? '')).toEqual({
      autoFixes: [],
      appliedFixes: [],
      proposals: [PROPOSAL],
      undo: null,
    });
  });

  it('is empty for another user', async () => {
    const result = await harness.execute('{ viewer { library { pendingFixes { fileName } } } }', {
      viewer: harness.bobViewer,
    });

    expect(
      (result.data as { viewer: { library: { pendingFixes: unknown[] } } }).viewer.library
        .pendingFixes
    ).toEqual([]);
  });
});

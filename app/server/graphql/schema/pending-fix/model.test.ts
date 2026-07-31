import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = '1'.repeat(32);

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
      // A genuinely-pending fix: `getPendingFixes` (book-store.ts) treats a row
      // with no proposals and no undo as already resolved and deletes it on
      // read, so an empty `proposals` array here would make `Library.pendingFixes`
      // correctly return `[]` — starving the "lists" test below of any row to
      // find, even though `Book.pendingFix` (a raw relation, no such cleanup)
      // would still see it. A non-empty `proposals` array keeps the fixture
      // "pending" under both readings.
      state:
        '{"proposals":[{"field":"title","kind":"replace","from":"Old Title","to":"New Title","changes":{}}]}',
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
      `{ viewer { library { book(id: "${BOOK_ID}") { pendingFix { fileName fileSize } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { pendingFix: unknown } } } }).viewer.library
        .book.pendingFix
    ).toEqual({ fileName: 'needs-fixing.epub', fileSize: 2048 });
  });

  it('lists the library pending fixes', async () => {
    const result = await harness.execute('{ viewer { library { pendingFixes { fileName } } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { pendingFixes: unknown[] } } }).viewer.library
        .pendingFixes
    ).toEqual([{ fileName: 'needs-fixing.epub' }]);
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

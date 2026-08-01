import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = '5'.repeat(32);

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: BOOK_ID,
      title: 'Edited',
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.bookIdHistory.create({
    data: {
      userId: harness.aliceOwner.userId,
      oldId: '6'.repeat(32),
      currentId: BOOK_ID,
      timestamp: 1_700_000_000_000,
      type: 'edit',
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Book.lineage', () => {
  it('lists the ids this book has previously had', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { lineage { oldId newId type timestamp } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const lineage = (
      result.data as {
        viewer: {
          library: {
            book: { lineage: { oldId: string; newId: string; type: string; timestamp: string }[] };
          };
        };
      }
    ).viewer.library.book.lineage;
    expect(lineage).toHaveLength(1);
    // Discriminating case for LineageType: stored 'edit' must serialize as wire 'EDIT'.
    expect(lineage[0]).toEqual({
      oldId: '6'.repeat(32),
      newId: BOOK_ID,
      type: 'EDIT',
      timestamp: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it('is empty for a book that has never been re-imported', async () => {
    await harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id: '7'.repeat(32),
        title: 'Untouched',
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });

    const result = await harness.execute(
      `{ viewer { library { book(id: "${'7'.repeat(32)}") { lineage { oldId } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { lineage: unknown[] } } } }).viewer.library.book
        .lineage
    ).toEqual([]);
  });

  // Book ids are content hashes (partial MD5), so two users routinely hold a
  // book with the identical id for the identical file — see NO_MATCH_USER_ID's
  // doc comment in node-scope.ts and Progress's identical concern in
  // progress/model.test.ts. `Book.lineage` must key off the *book's* userId
  // (via `context.loadOwner(parent.userId)`), not any id shared across
  // tenants, or bob would see alice's lineage for a book they both happen to
  // own under the same id.
  it('does not leak another user lineage for a book sharing the same id', async () => {
    await harness.prisma.book.create({
      data: {
        userId: harness.bobOwner.userId,
        id: BOOK_ID,
        title: 'Edited',
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });
    await harness.prisma.bookIdHistory.create({
      data: {
        userId: harness.bobOwner.userId,
        oldId: '9'.repeat(32),
        currentId: BOOK_ID,
        timestamp: 1_700_000_001_000,
        type: 'merge',
      },
    });

    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { lineage { oldId type } } } } }`,
      { viewer: harness.bobViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (
        result.data as {
          viewer: { library: { book: { lineage: { oldId: string; type: string }[] } } };
        }
      ).viewer.library.book.lineage
    ).toEqual([{ oldId: '9'.repeat(32), type: 'MERGE' }]);
  });
});

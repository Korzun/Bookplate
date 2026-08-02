import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = '5'.repeat(32);

// Computed the same way the resolver decodes it — see validate.test.ts's
// identical `bookGlobalId` helper.
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

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
  it('lists the ids this book has previously had, with resolvable/null edges', async () => {
    const gid = bookGlobalId(harness.aliceOwner.userId, BOOK_ID);
    const result = await harness.execute(
      `{ viewer { library { book(id: "${gid}") { lineage { oldId newId type timestamp oldBook { id } newBook { id } } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const lineage = (
      result.data as {
        viewer: {
          library: {
            book: {
              lineage: {
                oldId: string;
                newId: string;
                type: string;
                timestamp: string;
                oldBook: { id: string } | null;
                newBook: { id: string } | null;
              }[];
            };
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
      // `oldId` ('6'.repeat(32)) never got a `Book` row of its own — only a
      // `BookIdHistory` entry naming it — so `oldBook` is the "unknown/
      // deleted old id resolves null" arm.
      oldBook: null,
      // `newId` IS this book's own current, live id, so `newBook` is the
      // "resolved edge for a live book" arm.
      newBook: { id: gid },
    });
  });

  // Task-2 review, I-2: admin-traversal-asserting-CONTENTS discriminator for
  // `oldBook`/`newBook`'s owner source. `Book.lineage` (book/model.ts)
  // threads `entry.userId` from `parent.userId` (the target book's real
  // owner) — if that were substituted with `context.viewer?.userId` instead,
  // this breaks specifically for an admin viewer: the config-admin's own
  // `userId` is `null` (test-util.ts's `adminViewer`), so the `newBook`
  // lookup would run under a non-existent owner and resolve null instead of
  // alice's real, live row. A self-read (the first test above) cannot
  // discriminate this — alice's own `context.viewer.userId` and the row's
  // real `userId` are the same value.
  it("resolves newBook to the target owner's real row under admin traversal, not the viewer's", async () => {
    const gid = bookGlobalId(harness.aliceOwner.userId, BOOK_ID);
    const result = await harness.execute(
      `query ($id: ID!) {
        user(id: $id) {
          library {
            book(id: "${gid}") {
              lineage { oldId newId oldBook { id } newBook { id title } }
            }
          }
        }
      }`,
      { viewer: harness.adminViewer, variables: { id: harness.aliceGlobalId } }
    );

    expect(result.errors).toBeUndefined();
    const lineage = (
      result.data as {
        user: {
          library: {
            book: {
              lineage: {
                oldId: string;
                newId: string;
                oldBook: unknown;
                newBook: { id: string; title: string } | null;
              }[];
            };
          };
        };
      }
    ).user.library.book.lineage;
    expect(lineage).toHaveLength(1);
    expect(lineage[0]?.oldBook).toBeNull();
    expect(lineage[0]?.newBook).toEqual({ id: gid, title: 'Edited' });
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
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, '7'.repeat(32))}") { lineage { oldId } } } } }`,
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
      `{ viewer { library { book(id: "${bookGlobalId(harness.bobOwner.userId, BOOK_ID)}") { lineage { oldId type } } } } }`,
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

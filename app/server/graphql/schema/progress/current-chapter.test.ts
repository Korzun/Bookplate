import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = '7'.repeat(32);
// Chapters start at spine indices 0, 3 and 6, so spine index 4 is chapter 2.
const SPINE_MAP = [0, 3, 6];
// parseCfiSpineIndex maps /6/N to (N - 2) / 2, so /6/10 is spine index 4.
const CFI_SPINE_4 = 'EPUB_CFI(/6/10!/4/2:0)';

const seedBook = async (userId: string, id: string, spineMap: number[]) =>
  harness.prisma.book.create({
    data: {
      userId,
      id,
      title: 'Chaptered',
      size: 1,
      mtime: 1,
      addedAt: 1,
      chapterSpineMap: JSON.stringify(spineMap),
    },
  });

const seedProgress = async (userId: string, document: string, progress: string) =>
  harness.prisma.progress.create({
    data: {
      userId,
      document,
      progress,
      percentage: 0.5,
      device: 'Kobo',
      deviceId: 'dev-1',
      timestamp: 1_700_000_000,
    },
  });

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const readChapter = async (viewer: Harness['aliceViewer'], first = 10) => {
  const result = await harness.execute(
    `{ viewer { library { progress(first: ${first}) { edges { node { currentChapter } } } } } }`,
    { viewer }
  );
  expect(result.errors).toBeUndefined();
  return (
    result.data as {
      viewer: {
        library: { progress: { edges: { node: { currentChapter: number | null } }[] } };
      };
    }
  ).viewer.library.progress.edges.map((e) => e.node.currentChapter);
};

describe('Progress.currentChapter', () => {
  it("derives the chapter from the CFI and the book's spine map", async () => {
    await seedBook(harness.aliceOwner.userId, BOOK_ID, SPINE_MAP);
    await seedProgress(harness.aliceOwner.userId, BOOK_ID, CFI_SPINE_4);

    expect(await readChapter(harness.aliceViewer)).toEqual([2]);
  });

  it('is null when the progress string is not an EPUB CFI', async () => {
    // KOReader also writes this form, which carries no spine index at all.
    await seedBook(harness.aliceOwner.userId, BOOK_ID, SPINE_MAP);
    await seedProgress(harness.aliceOwner.userId, BOOK_ID, '/body/DocFragment[3]');

    expect(await readChapter(harness.aliceViewer)).toEqual([null]);
  });

  it('is null when the book has no chapter spine map', async () => {
    await seedBook(harness.aliceOwner.userId, BOOK_ID, []);
    await seedProgress(harness.aliceOwner.userId, BOOK_ID, CFI_SPINE_4);

    expect(await readChapter(harness.aliceViewer)).toEqual([null]);
  });

  it('is null when the progress row has no matching book at all', async () => {
    await seedProgress(harness.aliceOwner.userId, BOOK_ID, CFI_SPINE_4);

    expect(await readChapter(harness.aliceViewer)).toEqual([null]);
  });

  // Book ids are content hashes, so bob may hold a book with the identical id
  // and a DIFFERENT spine map. The spine map consulted must be the one
  // belonging to the progress row's own owner.
  it("uses the owner's copy of the book, not another user's book of the same id", async () => {
    await seedBook(harness.aliceOwner.userId, BOOK_ID, SPINE_MAP);
    // Bob's copy starts every chapter at 0, so spine index 4 is chapter 1
    // there and chapter 2 in alice's.
    await seedBook(harness.bobOwner.userId, BOOK_ID, [0]);
    await seedProgress(harness.aliceOwner.userId, BOOK_ID, CFI_SPINE_4);
    await seedProgress(harness.bobOwner.userId, BOOK_ID, CFI_SPINE_4);

    expect(await readChapter(harness.aliceViewer)).toEqual([2]);
    expect(await readChapter(harness.bobViewer)).toEqual([1]);
  });

  /**
   * The discriminating case for "reads the owner off its parent": the
   * config-based admin has a null `userId` and owns no books, so a resolver
   * that consulted the viewer rather than the progress row's own `userId`
   * would find no spine map and report null here, while every self-read test
   * above kept passing.
   */
  it("uses the progress row's own owner when an admin reads another user's library", async () => {
    await seedBook(harness.aliceOwner.userId, BOOK_ID, SPINE_MAP);
    await seedProgress(harness.aliceOwner.userId, BOOK_ID, CFI_SPINE_4);

    const result = await harness.execute(
      `query ($id: ID!) { user(id: $id) { library { progress(first: 10) {
        edges { node { currentChapter } }
      } } } }`,
      { viewer: harness.adminViewer, variables: { id: harness.aliceGlobalId } }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (
        result.data as {
          user: {
            library: { progress: { edges: { node: { currentChapter: number | null } }[] } };
          };
        }
      ).user.library.progress.edges.map((e) => e.node.currentChapter)
    ).toEqual([2]);
  });

  // A resolver has no page to batch spine-map lookups over, so this used to go
  // through `context.loadChapterSpineMap`, which turned N `book.findUnique`
  // calls into one `book.findMany`. The spine map now rides in on a field
  // `select` over the `book` relation, merged into `Library.progress`'s own
  // query — so the assertion is ZERO book queries, not one batched query.
  // 15 rows, so a per-row lookup could not hide.
  it('reads the spine map off the page query, with no book lookup of its own', async () => {
    for (let i = 0; i < 15; i++) {
      const id = i.toString().padStart(32, '0');
      await seedBook(harness.aliceOwner.userId, id, SPINE_MAP);
      await seedProgress(harness.aliceOwner.userId, id, CFI_SPINE_4);
    }

    const findUniqueSpy = vi.spyOn(harness.prisma.book, 'findUnique');
    const findManySpy = vi.spyOn(harness.prisma.book, 'findMany');
    const progressSpy = vi.spyOn(harness.prisma.progress, 'findMany');

    expect(await readChapter(harness.aliceViewer, 50)).toEqual(Array(15).fill(2));
    expect(findUniqueSpy).not.toHaveBeenCalled();
    expect(findManySpy).not.toHaveBeenCalled();
    expect(progressSpy).toHaveBeenCalledTimes(1);
  });

  // The predecessor of this test armed `book.findMany` to reject, because the
  // spine map came from its own batched query and the loader owned settling
  // every batched caller's promise — a loader that captured only `resolve`
  // would leave the request HANGING rather than erroring. There is no second
  // query and no loader now, so the equivalent failure is the page query
  // itself failing, and the equivalent risk is that it surfaces as a hang or a
  // 500 rather than a GraphQL error. Must fail fast, not stall the suite.
  it('surfaces a GraphQL error instead of hanging when the page query fails', async () => {
    await seedProgress(harness.aliceOwner.userId, BOOK_ID, CFI_SPINE_4);
    vi.spyOn(harness.prisma.progress, 'findMany').mockRejectedValue(new Error('db unavailable'));

    const result = await harness.execute(
      '{ viewer { library { progress(first: 10) { edges { node { currentChapter } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  }, 2000);
});

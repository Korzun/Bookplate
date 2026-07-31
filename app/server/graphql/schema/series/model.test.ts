import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.series.create({
    data: {
      id: 'series-1',
      userId: harness.aliceOwner.userId,
      name: 'The Expanse',
      sortKey: 'expanse',
      bookCount: 2,
      author: 'James S. A. Corey',
      subjects: '["Sci-Fi"]',
    },
  });
  for (const [i, id] of ['b'.repeat(32), 'c'.repeat(32)].entries()) {
    await harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id,
        title: `Book ${i + 1}`,
        // `getSeriesNextIndex` (BookStore, unmodified) filters by the
        // denormalized `series` string column, not `seriesId` — every real
        // import path sets both together (see book-store.ts's
        // `series: meta.series` / `seriesId` pairs), so the fixture must too
        // or `seriesNextIndex` sees no rows for "The Expanse".
        series: 'The Expanse',
        seriesId: 'series-1',
        seriesIndex: i + 1,
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });
  }
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Series', () => {
  it('exposes a series with its member books in index order', async () => {
    const result = await harness.execute(
      '{ viewer { library { seriesByName(name: "The Expanse") { name bookCount books { title seriesIndex } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const series = (
      result.data as {
        viewer: { library: { seriesByName: { books: { title: string }[] } } };
      }
    ).viewer.library.seriesByName;
    expect(series.books.map((b) => b.title)).toEqual(['Book 1', 'Book 2']);
  });

  it('links a book back to its series', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${'b'.repeat(32)}") { series { name } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { series: { name: string } } } } }).viewer
        .library.book.series.name
    ).toBe('The Expanse');
  });

  it('returns the next free index for an existing series', async () => {
    const result = await harness.execute(
      '{ viewer { library { seriesNextIndex(name: "The Expanse") } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { seriesNextIndex: number } } }).viewer.library
        .seriesNextIndex
    ).toBe(3);
  });

  it('returns a first index for a series that does not exist yet', async () => {
    const result = await harness.execute(
      '{ viewer { library { seriesNextIndex(name: "Brand New") } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { seriesNextIndex: number } } }).viewer.library
        .seriesNextIndex
    ).toBe(1);
  });

  it('does not expose another user series', async () => {
    const result = await harness.execute(
      '{ viewer { library { seriesByName(name: "The Expanse") { name } } } }',
      { viewer: harness.bobViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { seriesByName: unknown } } }).viewer.library
        .seriesByName ?? null
    ).toBeNull();
  });
});

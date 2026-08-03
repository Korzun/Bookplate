import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

// Computed the same way the resolver decodes it — see validate.test.ts's
// identical `bookGlobalId` helper.
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

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
      '{ viewer { library { seriesByName(name: "The Expanse") { name bookCount books { edges { node { title seriesIndex } } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const series = (
      result.data as {
        viewer: {
          library: { seriesByName: { books: { edges: { node: { title: string } }[] } } };
        };
      }
    ).viewer.library.seriesByName;
    expect(series.books.edges.map((e) => e.node.title)).toEqual(['Book 1', 'Book 2']);
  });

  it('links a book back to its series', async () => {
    const gid = bookGlobalId(harness.aliceOwner.userId, 'b'.repeat(32));
    const result = await harness.execute(
      `{ viewer { library { book(id: "${gid}") { series { name } } } } }`,
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

  it('is typed as a GraphQL Int, not a Float', async () => {
    const result = await harness.execute(
      `{ __type(name: "Library") { fields(includeDeprecated: true) {
        name type { kind ofType { name } }
      } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const fields = (
      result.data as { __type: { fields: { name: string; type: { ofType: { name: string } } }[] } }
    ).__type.fields;
    const seriesNextIndex = fields.find((f) => f.name === 'seriesNextIndex');
    expect(seriesNextIndex?.type.ofType.name).toBe('Int');
  });

  it('floors a fractional max seriesIndex before returning the next ordinal', async () => {
    // `seriesIndex` is a Prisma `Float` column (fractional indices are a real
    // import shape — half-numbered inserts between two existing volumes), but
    // `seriesNextIndex` is a GraphQL `Int!`. The store already does
    // `Math.floor(max) + 1`; this proves that behaviour survives the retype
    // rather than merely asserting the schema's declared type.
    await harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id: 'z'.repeat(32),
        title: 'Fractional Volume',
        series: 'The Expanse',
        seriesId: 'series-1',
        seriesIndex: 2.5,
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });

    const result = await harness.execute(
      '{ viewer { library { seriesNextIndex(name: "The Expanse") } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    // Max seriesIndex is now 2.5 (the fractional row beats the two integer
    // ones seeded in beforeEach) — floor(2.5) + 1 = 3, not 3.5.
    expect(
      (result.data as { viewer: { library: { seriesNextIndex: number } } }).viewer.library
        .seriesNextIndex
    ).toBe(3);
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

  it('lists a viewer own series, ordered by sortKey', async () => {
    // sortKey "aaa first" sorts before "expanse", so a correct `orderBy:
    // { sortKey: 'asc' }` puts this ahead of "The Expanse" even though it was
    // inserted second.
    await harness.prisma.series.create({
      data: {
        id: 'series-2',
        userId: harness.aliceOwner.userId,
        name: 'A First',
        sortKey: 'aaa first',
      },
    });

    const result = await harness.execute('{ viewer { library { series { name } } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(
      (
        result.data as { viewer: { library: { series: { name: string }[] } } }
      ).viewer.library.series.map((s) => s.name)
    ).toEqual(['A First', 'The Expanse']);
  });

  it('does not expose another user series in the list', async () => {
    const result = await harness.execute('{ viewer { library { series { name } } } }', {
      viewer: harness.bobViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { series: { name: string }[] } } }).viewer.library.series
    ).toEqual([]);
  });
});

describe('Series.books connection', () => {
  type BooksPage = {
    edges: { cursor: string; node: { title: string; seriesIndex: number } }[];
  };
  type BooksData = { viewer: { library: { seriesByName: { books: BooksPage } } } };

  const PAGE = `
    query ($first: Int, $after: String, $last: Int, $before: String) {
      viewer { library { seriesByName(name: "The Expanse") {
        books(first: $first, after: $after, last: $last, before: $before) {
          edges { cursor node { title seriesIndex } }
          pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
        }
      } } }
    }
  `;

  const readBooks = async (variables: Record<string, unknown>) => {
    const result = await harness.execute(PAGE, { viewer: harness.aliceViewer, variables });
    expect(result.errors).toBeUndefined();
    return (result.data as BooksData).viewer.library.seriesByName.books;
  };

  beforeEach(async () => {
    // Three more books beyond the two `beforeEach` above seeds (indices 1, 2),
    // for a five-book series — enough to prove `first`/`after` advance the
    // page and `last`/`before` genuinely paginate backward, not just accept
    // the arguments.
    for (const [i, id] of ['3'.repeat(32), '4'.repeat(32), '5'.repeat(32)].entries()) {
      await harness.prisma.book.create({
        data: {
          userId: harness.aliceOwner.userId,
          id,
          title: `Book ${i + 3}`,
          series: 'The Expanse',
          seriesId: 'series-1',
          seriesIndex: i + 3,
          size: 1,
          mtime: 1,
          addedAt: 1,
        },
      });
    }
  });

  it('orders by seriesIndex ascending', async () => {
    const page = await readBooks({ first: 10 });

    expect(page.edges.map((e) => e.node.title)).toEqual([
      'Book 1',
      'Book 2',
      'Book 3',
      'Book 4',
      'Book 5',
    ]);
  });

  it('paginates forward — page two differs from page one when the cursor is fed back as `after`', async () => {
    const first = await readBooks({ first: 2 });

    expect(first.edges.map((e) => e.node.title)).toEqual(['Book 1', 'Book 2']);
    expect(first.pageInfo.hasNextPage).toBe(true);

    const second = await readBooks({ first: 2, after: first.edges[1].cursor });

    // Genuinely distinguishes "after is honored" from "after is ignored": an
    // ignored cursor would hand back page one again.
    expect(second.edges.map((e) => e.node.title)).toEqual(['Book 3', 'Book 4']);
  });

  it('accepts a per-edge cursor as `after`, not only pageInfo.endCursor', async () => {
    const all = await readBooks({ first: 10 });

    const after = await readBooks({ first: 10, after: all.edges[0].cursor });

    expect(after.edges.map((e) => e.node.title)).toEqual(['Book 2', 'Book 3', 'Book 4', 'Book 5']);
  });

  // `last`/`before` genuinely work here — `t.relatedConnection` paginates a
  // real Prisma relation and supports backward pagination natively, unlike
  // `Library.entries`/`Library.progress` (see `rejectBackwardPagination`'s
  // doc comment in `pagination.ts`). This must not merely be "accepted
  // without error" — it must return the actual trailing page.
  it('supports `last` alone, returning the trailing page in ascending order', async () => {
    const page = await readBooks({ last: 2 });

    expect(page.edges.map((e) => e.node.title)).toEqual(['Book 4', 'Book 5']);
  });

  it('supports `last`/`before` together, walking backward from a cursor', async () => {
    const all = await readBooks({ first: 10 });
    const lastEdgeCursor = all.edges[all.edges.length - 1].cursor; // Book 5

    const page = await readBooks({ last: 2, before: lastEdgeCursor });

    // The two books immediately before Book 5, in ascending order — proves
    // `before` is honored (not ignored, which would return the unfiltered
    // trailing page again) and that the two combine correctly.
    expect(page.edges.map((e) => e.node.title)).toEqual(['Book 3', 'Book 4']);
  });

  it('does not leak another user series books', async () => {
    const result = await harness.execute(
      `{ viewer { library { seriesByName(name: "The Expanse") { books(first: 10) { edges { node { title } } } } } } }`,
      { viewer: harness.bobViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { seriesByName: unknown } } }).viewer.library
        .seriesByName ?? null
    ).toBeNull();
  });

  // Query-cost-control task 1. `Series.books` reached this way
  // (`Library.seriesByName`, a `t.prismaField`) drives Pothos's own
  // query-planning walk — `series/model.ts`'s doc comment on this field has
  // the full mechanism reasoning (why the reject lives in the `query`
  // callback, not a `resolve` override).
  describe('page-size bound', () => {
    it('rejects `first` one above the max page size (100)', async () => {
      const result = await harness.execute(PAGE, {
        viewer: harness.aliceViewer,
        variables: { first: 101 },
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.extensions).toEqual({
        code: 'PAGE_SIZE_EXCEEDED',
        http: { status: 400 },
      });
    });

    it('accepts `first` exactly at the max page size (100)', async () => {
      const result = await harness.execute(PAGE, {
        viewer: harness.aliceViewer,
        variables: { first: 100 },
      });

      expect(result.errors).toBeUndefined();
    });

    it('returns at most the default page size (20) when `first` is omitted', async () => {
      // Five books already exist (the fixtures above) — far below the
      // default of 20. Seed enough more that the assertion actually
      // discriminates a bound from no bound at all.
      for (let i = 0; i < 20; i++) {
        await harness.prisma.book.create({
          data: {
            userId: harness.aliceOwner.userId,
            id: `6${String(i).padStart(2, '0')}`.padEnd(32, 'z'),
            title: `Filler ${i}`,
            series: 'The Expanse',
            seriesId: 'series-1',
            seriesIndex: i + 10,
            size: 1,
            mtime: 1,
            addedAt: 1,
          },
        });
      }

      const result = await harness.execute(
        `{ viewer { library { seriesByName(name: "The Expanse") { books {
          edges { node { title } }
          pageInfo { hasNextPage }
        } } } } }`,
        { viewer: harness.aliceViewer }
      );

      expect(result.errors).toBeUndefined();
      const books = (
        result.data as {
          viewer: {
            library: {
              seriesByName: { books: { edges: unknown[]; pageInfo: { hasNextPage: boolean } } };
            };
          };
        }
      ).viewer.library.seriesByName.books;
      expect(books.edges).toHaveLength(20);
      expect(books.pageInfo.hasNextPage).toBe(true);
    });

    // The OTHER reachable path to `Series.books`: through `LibraryEntry`'s
    // union arm off `Library.entries`, where the parent `Series` row is
    // hand-fetched (`context.prisma.series.findMany()`, `library/model.ts`)
    // rather than produced by Pothos's own query-planning — the existing
    // "resolves a nested relation (Series.books) through the union" test
    // (`library/entries.test.ts`) documents that this takes the Prisma
    // plugin's per-row FALLBACK path, the opposite of `seriesByName`'s
    // planned-query path above. Both must reject; this is the one that
    // would silently keep clamping if the guard only worked by accident on
    // one of the two.
    it('rejects an oversize `first` reached through the LibraryEntry union arm too', async () => {
      const result = await harness.execute(
        `{ viewer { library { entries(first: 10) {
          edges { node { __typename ... on Series { books(first: 101) { edges { node { title } } } } } }
        } } } }`,
        { viewer: harness.aliceViewer }
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.extensions).toEqual({
        code: 'PAGE_SIZE_EXCEEDED',
        http: { status: 400 },
      });
    });
  });
});

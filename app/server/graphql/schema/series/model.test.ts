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
        // `getSeriesNextIndex` (`services/series-next-index.ts`, unmodified
        // since its extraction from `BookStore`) filters by the denormalized
        // `series` string column, not `seriesId` — every real import path
        // sets both together (see `book-lifecycle.ts`'s `addBook`,
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
    // `seriesNextIndex` is a GraphQL `Int!`. `getSeriesNextIndex` already does
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

describe('Series.progressPercentage', () => {
  const QUERY =
    '{ viewer { library { seriesByName(name: "The Expanse") { progressPercentage } } } }';

  const readProgress = async (viewer = harness.aliceViewer): Promise<number | null> => {
    const result = await harness.execute(QUERY, { viewer });
    expect(result.errors).toBeUndefined();
    return (
      (
        result.data as {
          viewer: { library: { seriesByName: { progressPercentage: number | null } | null } };
        }
      ).viewer.library.seriesByName?.progressPercentage ?? null
    );
  };

  const seedProgress = (userId: string, document: string, percentage: number) =>
    harness.prisma.progress.create({
      data: {
        userId,
        document,
        progress: '/x',
        percentage,
        device: 'Kobo',
        deviceId: 'dev-1',
        timestamp: 1,
      },
    });

  // The two "Expanse" books seeded by the outer `beforeEach` are
  // `'b'.repeat(32)` (Book 1) and `'c'.repeat(32)` (Book 2), neither with a
  // progress row yet.
  it('is null when none of the series books have a progress row', async () => {
    expect(await readProgress()).toBeNull();
  });

  it('is the mean of member books, treating a missing progress row as 0%', async () => {
    await seedProgress(harness.aliceOwner.userId, 'b'.repeat(32), 0.8);
    // Book 2 has no progress row at all -> counts as 0. (0.8 + 0) / 2 = 0.4,
    // matching `calculateSeriesProgressPercent`'s "returns the percentage
    // when only one book has progress" case (helper.test.ts).
    expect(await readProgress()).toBeCloseTo(0.4);
  });

  it('averages across every member book when more than one has progress', async () => {
    await seedProgress(harness.aliceOwner.userId, 'b'.repeat(32), 0.6);
    await seedProgress(harness.aliceOwner.userId, 'c'.repeat(32), 0.9);
    // No third book here, unlike the client helper's three-book fixture, but
    // the same averaging rule: (0.6 + 0.9) / 2 = 0.75.
    expect(await readProgress()).toBeCloseTo(0.75);
  });

  it('is 1 when every member book is fully read', async () => {
    await seedProgress(harness.aliceOwner.userId, 'b'.repeat(32), 1);
    await seedProgress(harness.aliceOwner.userId, 'c'.repeat(32), 1);
    expect(await readProgress()).toBe(1);
  });

  it('is 0 when the only progress row that exists reads 0%', async () => {
    // The row is truthy even at 0% — this must not be confused with "no
    // progress row at all", which resolves null, not 0 (helper.test.ts's
    // "returns 0 when the only progress entry has 0%" pins the same
    // distinction client-side).
    await seedProgress(harness.aliceOwner.userId, 'b'.repeat(32), 0);
    expect(await readProgress()).toBe(0);
  });

  it('is null for a series with no member books', async () => {
    await harness.prisma.series.create({
      data: {
        id: 'series-empty',
        userId: harness.aliceOwner.userId,
        name: 'Empty Series',
        sortKey: 'empty series',
        bookCount: 0,
      },
    });

    const result = await harness.execute(
      '{ viewer { library { seriesByName(name: "Empty Series") { progressPercentage } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (
        result.data as {
          viewer: { library: { seriesByName: { progressPercentage: number | null } } };
        }
      ).viewer.library.seriesByName.progressPercentage
    ).toBeNull();
  });

  // `document` is a KOReader content hash and collides across tenants
  // (`progress-loader.ts`'s doc comment) — this proves the aggregate is
  // scoped by owner, not merely by book id, guarding against the two-query
  // loader ever cross-matching a book from one user's batch against another
  // user's progress row for the same content hash.
  it('scopes progress by owner, not bare book id, when two users share a content-hash book id', async () => {
    await harness.prisma.series.create({
      data: {
        id: 'series-bob',
        userId: harness.bobOwner.userId,
        name: 'Bob Series',
        sortKey: 'bob series',
        bookCount: 1,
      },
    });
    await harness.prisma.book.create({
      data: {
        userId: harness.bobOwner.userId,
        id: 'b'.repeat(32), // same content hash as alice's own Book 1
        title: 'Bob Book 1',
        series: 'Bob Series',
        seriesId: 'series-bob',
        seriesIndex: 1,
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });
    await seedProgress(harness.bobOwner.userId, 'b'.repeat(32), 0.99);

    // Alice has no progress on her own copy of that same content-hash id —
    // a leak would show 0.99 or an average including it instead of null.
    expect(await readProgress(harness.aliceViewer)).toBeNull();
  });

  it('does not expose another user series progress', async () => {
    await seedProgress(harness.aliceOwner.userId, 'b'.repeat(32), 0.8);

    const result = await harness.execute(QUERY, { viewer: harness.bobViewer });

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { seriesByName: unknown } } }).viewer.library
        .seriesByName ?? null
    ).toBeNull();
  });

  // Computing progress per series across a page of `Library.entries` (priced
  // at `maxSize` 100, `cost-limit.ts`/`pagination.ts`) must not issue a query
  // per series — see `series-progress-loader.ts`'s doc comment. 20 series
  // here stands in for a page at that scale; the loader itself doesn't know
  // or care which field reached it, so this mirrors `Book.progress`'s own
  // batching test (`progress/model.test.ts`) one level up the graph.
  it('batches Series.progressPercentage across a page of series into a fixed number of queries, not one per series', async () => {
    for (let i = 0; i < 20; i++) {
      const seriesId = `series-batch-${i}`;
      const bookId = i.toString().padStart(32, '9');
      await harness.prisma.series.create({
        data: {
          id: seriesId,
          userId: harness.aliceOwner.userId,
          name: `Batch Series ${i}`,
          sortKey: `batch series ${i}`,
          bookCount: 1,
        },
      });
      await harness.prisma.book.create({
        data: {
          userId: harness.aliceOwner.userId,
          id: bookId,
          title: `Batch Book ${i}`,
          series: `Batch Series ${i}`,
          seriesId,
          seriesIndex: 1,
          size: 1,
          mtime: 1,
          addedAt: 1,
        },
      });
      await seedProgress(harness.aliceOwner.userId, bookId, 0.1 * (i % 10));
    }

    const bookFindManySpy = vi.spyOn(harness.prisma.book, 'findMany');
    const progressFindManySpy = vi.spyOn(harness.prisma.progress, 'findMany');

    const fields = Array.from(
      { length: 20 },
      (_, i) => `s${i}: seriesByName(name: "Batch Series ${i}") { progressPercentage }`
    ).join(' ');
    const result = await harness.execute(`{ viewer { library { ${fields} } } }`, {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    for (let i = 0; i < 20; i++) {
      expect(
        (result.data as Record<string, { library: Record<string, { progressPercentage: number }> }>)
          .viewer.library[`s${i}`].progressPercentage
      ).toBeCloseTo(0.1 * (i % 10));
    }
    expect(bookFindManySpy).toHaveBeenCalledTimes(1);
    expect(progressFindManySpy).toHaveBeenCalledTimes(1);
  });

  // A prior version of `createProgressLoader` captured only `resolve`, never
  // `reject`, when it took over settling each batched caller's promise. A
  // rejected `findMany` then left every in-flight lookup in that batch
  // permanently unsettled instead of surfacing a GraphQL error — this proves
  // `createSeriesProgressLoader` doesn't repeat that gap, on both of its
  // queries.
  it('surfaces a GraphQL error instead of hanging when the member-books query fails', async () => {
    vi.spyOn(harness.prisma.book, 'findMany').mockRejectedValue(new Error('db unavailable'));

    const result = await harness.execute(QUERY, { viewer: harness.aliceViewer });

    expect(result.errors).toBeDefined();
  });

  it('surfaces a GraphQL error instead of hanging when the progress query fails', async () => {
    await seedProgress(harness.aliceOwner.userId, 'b'.repeat(32), 0.8);
    vi.spyOn(harness.prisma.progress, 'findMany').mockRejectedValue(new Error('db unavailable'));

    const result = await harness.execute(QUERY, { viewer: harness.aliceViewer });

    expect(result.errors).toBeDefined();
  });
});

describe('Series.books connection', () => {
  type BooksPage = {
    edges: { cursor: string; node: { title: string; seriesIndex: number } }[];
    // The query selects `pageInfo` too; declaring only `edges` left every
    // `pageInfo` assertion below unchecked.
    pageInfo: {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      startCursor: string | null;
      endCursor: string | null;
    };
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
  // `Library.entries`, whose SDL does not offer the two arguments at all (see
  // the `entriesConnection` doc comment in `library/model.ts`).
  // `Library.progress` used to be named here too and no longer is: it is a
  // `t.prismaConnection` now and pages backward as well, with its own
  // equivalent tests in `library/progress.test.ts`. This must not merely be
  // "accepted without error" — it must return the actual trailing page.
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

    // Review I-2: `last` genuinely works on this connection (unlike
    // `Library.entries`, which does not declare the argument at all), so an
    // oversize `last` must be rejected too, not silently clamped by the native
    // `maxSize`. `Library.progress` now needs — and has — the identical guard,
    // for the identical reason.
    it('rejects `last` one above the max page size (100)', async () => {
      const result = await harness.execute(PAGE, {
        viewer: harness.aliceViewer,
        variables: { last: 101 },
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.extensions).toEqual({
        code: 'PAGE_SIZE_EXCEEDED',
        http: { status: 400 },
      });
    });

    it('accepts `last` exactly at the max page size (100)', async () => {
      const result = await harness.execute(PAGE, {
        viewer: harness.aliceViewer,
        variables: { last: 100 },
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

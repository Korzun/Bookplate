import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.series.create({
    data: {
      id: 's-1',
      userId: harness.aliceOwner.userId,
      name: 'Expanse',
      sortKey: 'expanse',
      bookCount: 1,
    },
  });
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: '2'.repeat(32),
      title: 'In Series',
      seriesId: 's-1',
      seriesIndex: 1,
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: '3'.repeat(32),
      title: 'Standalone',
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

const ENTRIES = `{
  viewer { library { entries(first: 10) {
    edges { cursor node { __typename ... on Book { title } ... on Series { name } } }
    pageInfo { hasNextPage endCursor }
  } } }
}`;

const ENTRIES_PAGE = `
  query ($after: String) {
    viewer { library { entries(first: 1, after: $after) {
      edges { node { __typename ... on Book { title } ... on Series { name } } }
      pageInfo { hasNextPage hasPreviousPage endCursor }
    } } }
  }
`;

type Node = { __typename: string; title?: string; name?: string };
type EntriesData = {
  viewer: {
    library: {
      entries: {
        edges: { cursor: string; node: Node }[];
        pageInfo: { hasNextPage: boolean; hasPreviousPage?: boolean; endCursor: string | null };
      };
    };
  };
};

describe('Library.entries', () => {
  it('interleaves series and standalone books as a union', async () => {
    const result = await harness.execute(ENTRIES, { viewer: harness.aliceViewer });

    expect(result.errors).toBeUndefined();
    const edges = (result.data as EntriesData).viewer.library.entries.edges;
    expect(edges.map((e) => e.node.__typename).sort()).toEqual(['Book', 'Series']);
  });

  it('reports no next page when the whole library fits on one page', async () => {
    const result = await harness.execute(ENTRIES, { viewer: harness.aliceViewer });

    expect((result.data as EntriesData).viewer.library.entries.pageInfo.hasNextPage).toBe(false);
  });

  it('paginates with the store cursor — after excludes items already returned', async () => {
    const first = await harness.execute(ENTRIES_PAGE, { viewer: harness.aliceViewer });
    expect(first.errors).toBeUndefined();
    const firstEntries = (first.data as EntriesData).viewer.library.entries;

    expect(firstEntries.edges).toHaveLength(1);
    expect(firstEntries.pageInfo.hasNextPage).toBe(true);
    expect(firstEntries.pageInfo.endCursor).not.toBeNull();
    // First page, no `after` given: there is nothing before it.
    expect(firstEntries.pageInfo.hasPreviousPage).toBe(false);

    const second = await harness.execute(ENTRIES_PAGE, {
      viewer: harness.aliceViewer,
      variables: { after: firstEntries.pageInfo.endCursor },
    });
    expect(second.errors).toBeUndefined();
    const secondEntries = (second.data as EntriesData).viewer.library.entries;

    expect(secondEntries.edges).toHaveLength(1);
    // Genuinely distinguishes "after is honored" from "after is ignored": if
    // the resolver dropped `after`, this second call would hand back the
    // exact same first-page entry rather than advancing past it.
    expect(secondEntries.edges[0].node).not.toEqual(firstEntries.edges[0].node);
    // Continuing from `after` means there is content before this page.
    expect(secondEntries.pageInfo.hasPreviousPage).toBe(true);
    // The fixture has exactly two top-level entries (one series, one
    // standalone); after consuming both a page at a time, no more remain.
    expect(secondEntries.pageInfo.hasNextPage).toBe(false);
  });

  // The pagination test above walks `pageInfo.endCursor`, which is the
  // store's own string forwarded untouched. The per-edge `cursor` values are
  // the ones this resolver mints itself (`encodeCursor`), and nothing
  // exercised them as an `after` value — so a mis-encoded edge cursor would
  // have shipped with a full green suite.
  it('accepts a per-edge cursor as `after`, not only pageInfo.endCursor', async () => {
    const all = await harness.execute(ENTRIES, { viewer: harness.aliceViewer });
    expect(all.errors).toBeUndefined();
    const allEdges = (all.data as EntriesData).viewer.library.entries.edges;
    expect(allEdges).toHaveLength(2);

    const after = await harness.execute(ENTRIES_PAGE, {
      viewer: harness.aliceViewer,
      variables: { after: allEdges[0].cursor },
    });
    expect(after.errors).toBeUndefined();
    const afterEntries = (after.data as EntriesData).viewer.library.entries;

    // Resuming after the FIRST edge must yield exactly the SECOND entry —
    // not the first again (cursor ignored) and not nothing (cursor
    // mis-encoded so it sorts past the end of the list).
    expect(afterEntries.edges).toHaveLength(1);
    expect(afterEntries.edges[0].node).toEqual(allEdges[1].node);
    expect(afterEntries.pageInfo.hasNextPage).toBe(false);
    expect(afterEntries.pageInfo.hasPreviousPage).toBe(true);
  });

  it("does not let one viewer see another viewer's library entries", async () => {
    // Alice (the fixture owner) sees her two entries...
    const aliceResult = await harness.execute(ENTRIES, { viewer: harness.aliceViewer });
    expect((aliceResult.data as EntriesData).viewer.library.entries.edges).toHaveLength(2);

    // ...but Bob, a distinct tenant with no books of his own, must not see
    // Alice's — a resolver that ignored `owner` (e.g. queried across all
    // users) would return Alice's 2 entries here instead of 0.
    const bobResult = await harness.execute(ENTRIES, { viewer: harness.bobViewer });
    expect((bobResult.data as EntriesData).viewer.library.entries.edges).toEqual([]);
  });

  // `services/library-page.ts`'s `listBooksPage` has no backward keyset to
  // walk, so this field
  // does not OFFER `last`/`before` — it is declared with a plain `t.field`
  // over an explicit `connectionObject` rather than `t.connection`, which
  // would inject all four Relay args unconditionally (see `library/model.ts`).
  // The rejection is therefore GraphQL's own unknown-argument validation,
  // before any resolver runs — not the resolver-level
  // `BACKWARD_PAGINATION_UNSUPPORTED` this used to throw while the SDL still
  // advertised an argument it refused.
  //
  // Asserted on the validation message, not `extensions.code`: this harness
  // calls graphql-js's `graphql()` directly, and graphql-js leaves a
  // validation error's `extensions` empty (`{}`). The
  // `GRAPHQL_VALIDATION_FAILED` code a client actually sees is stamped by
  // graphql-yoga at the HTTP transport, which `content-negotiation.test.ts`
  // pins separately. `data` being `undefined` (not `null`) is the second
  // half of the proof: the query never executed at all.
  it('does not offer `last` — it is rejected as an unknown argument', async () => {
    const result = await harness.execute(
      '{ viewer { library { entries(last: 5) { edges { node { __typename } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]?.message).toBe('Unknown argument "last" on field "Library.entries".');
    expect(result.data).toBeUndefined();
  });

  // Ordering probe, inherited from the `rejectOversizePage` precedence test
  // this replaces: `rejectOversizePage` still checks `last` (for
  // `Series.books`/`Validation.messages`, which do support it), so an
  // oversize `last` here must still surface as the unknown-argument
  // validation error and never as PAGE_SIZE_EXCEEDED. Validation runs before
  // execution, so the resolver's size guard is never reached.
  it('rejects an oversize `last` as an unknown argument, not PAGE_SIZE_EXCEEDED', async () => {
    const result = await harness.execute(
      '{ viewer { library { entries(last: 999999999) { edges { node { __typename } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]?.message).toBe('Unknown argument "last" on field "Library.entries".');
    expect(result.errors?.[0]?.extensions?.code).toBeUndefined();
  });

  it('does not offer `before` — it is rejected as an unknown argument', async () => {
    const result = await harness.execute(
      '{ viewer { library { entries(before: "some-opaque-cursor") { edges { node { __typename } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]?.message).toBe(
      'Unknown argument "before" on field "Library.entries".'
    );
    expect(result.data).toBeUndefined();
  });

  // Query-cost-control task 1: `first` above `CONNECTION_LIMITS.libraryEntries
  // .maxSize` (100, mirroring routes/ui.ts's own `take` clamp — see
  // pagination.ts's `CONNECTION_LIMITS` doc comment) is rejected loudly
  // rather than silently clamped. `999999999` is the spec's own probe value
  // (`docs/superpowers/specs/2026-08-02-query-cost-control-design.md`,
  // "no connection carries maxSize/defaultSize: entries(first: 999999999)
  // is depth 6").
  it('rejects `first: 999999999` instead of silently clamping it', async () => {
    const result = await harness.execute(
      '{ viewer { library { entries(first: 999999999) { edges { node { __typename } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]?.extensions).toEqual({
      code: 'PAGE_SIZE_EXCEEDED',
      http: { status: 400 },
    });
  });

  it('rejects `first` one above the max page size (100)', async () => {
    const result = await harness.execute(
      '{ viewer { library { entries(first: 101) { edges { node { __typename } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]?.extensions).toEqual({
      code: 'PAGE_SIZE_EXCEEDED',
      http: { status: 400 },
    });
  });

  it('accepts `first` exactly at the max page size (100)', async () => {
    const result = await harness.execute(
      '{ viewer { library { entries(first: 100) { edges { node { __typename } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
  });

  it('returns at most the default page size (20) when `first` is omitted', async () => {
    // The fixture above (`beforeEach`) seeds only 2 entries — far below the
    // default of 20, which would pass this test even with no bound at all.
    // Seed enough standalone books to exceed it.
    for (let i = 0; i < 25; i++) {
      await harness.prisma.book.create({
        data: {
          userId: harness.aliceOwner.userId,
          id: `4${String(i).padStart(2, '0')}`.padEnd(32, 'z'),
          title: `Filler ${i}`,
          size: 1,
          mtime: 1,
          addedAt: 1,
        },
      });
    }

    const result = await harness.execute(
      '{ viewer { library { entries { edges { node { __typename } } pageInfo { hasNextPage } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const entries = (
      result.data as {
        viewer: {
          library: { entries: { edges: unknown[]; pageInfo: { hasNextPage: boolean } } };
        };
      }
    ).viewer.library.entries;
    expect(entries.edges).toHaveLength(20);
    expect(entries.pageInfo.hasNextPage).toBe(true);
  });

  // The parent `Book`/`Series` rows this connection resolves into are hand-
  // fetched via context.prisma.book.findMany()/series.findMany() outside the
  // Prisma plugin's own query planning, so a nested relation off a union
  // member (Series.books, itself a `t.relatedConnection`) takes the plugin's
  // per-row fallback path rather than a single planned join. Exercise it for
  // real rather than assuming the documented fallback behaviour holds here.
  it('resolves a nested relation (Series.books) through the union', async () => {
    const result = await harness.execute(
      `{ viewer { library { entries(first: 10) {
        edges { node { __typename ... on Series { name books { edges { node { title } } } } } }
      } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const edges = (
      result.data as {
        viewer: {
          library: {
            entries: {
              edges: {
                node: {
                  __typename: string;
                  name?: string;
                  books?: { edges: { node: { title: string } }[] };
                };
              }[];
            };
          };
        };
      }
    ).viewer.library.entries.edges;
    const seriesEdge = edges.find((e) => e.node.__typename === 'Series');
    expect(seriesEdge?.node.books?.edges.map((e) => e.node)).toEqual([{ title: 'In Series' }]);
  });

  // Resolver-level regression guard for the double read task 8 fixed
  // (`services/library-page.ts`'s `listBooksPage`). The historical bug lived
  // HERE, in this resolver — `services/library-page.test.ts`'s own
  // "fetches every book exactly once" test only proves `listBooksPage` in
  // isolation issues one read; it says nothing about whether this resolver
  // adds a second one on top, which is exactly the shape the original bug
  // took (the store read once, the resolver re-fetched by id/name anyway).
  // A page mixing several series with standalones makes an N+1 unmistakable:
  // if this resolver ever re-fetches book/series rows itself again, the
  // series count multiplies the extra `book.findMany` calls rather than
  // adding a flat one.
  it('issues exactly one prisma.book.findMany and one prisma.series.findMany call per page', async () => {
    for (const s of ['Dune', 'Foundation', 'Wheel of Time']) {
      const seriesId = `s-${s.replace(/\s/g, '')}`;
      await harness.prisma.series.create({
        data: {
          id: seriesId,
          userId: harness.aliceOwner.userId,
          name: s,
          sortKey: s.toLowerCase(),
          bookCount: 2,
        },
      });
      for (let i = 1; i <= 2; i++) {
        await harness.prisma.book.create({
          data: {
            userId: harness.aliceOwner.userId,
            id: `${seriesId}-${i}`.padEnd(32, '0'),
            title: `${s} ${i}`,
            seriesId,
            seriesIndex: i,
            size: 1,
            mtime: 1,
            addedAt: 1,
          },
        });
      }
    }
    for (const title of ['Alone A', 'Alone B']) {
      await harness.prisma.book.create({
        data: {
          userId: harness.aliceOwner.userId,
          id: title.replace(/\s/g, '').padEnd(32, '0'),
          title,
          size: 1,
          mtime: 1,
          addedAt: 1,
        },
      });
    }

    const bookSpy = vi.spyOn(harness.prisma.book, 'findMany');
    const seriesSpy = vi.spyOn(harness.prisma.series, 'findMany');

    const result = await harness.execute(ENTRIES, { viewer: harness.aliceViewer });

    expect(result.errors).toBeUndefined();
    expect(bookSpy).toHaveBeenCalledTimes(1);
    expect(seriesSpy).toHaveBeenCalledTimes(1);
  });
});

// Task 5 (remove-stores phase 4): `listBooksPage`'s `prisma.book.findMany`
// (`services/library-page.ts`) used to carry no `select` at all, so every
// standalone row on a page — up to 20 — came back with `coverData`
// (`prisma/schema.prisma`'s `Bytes?` cover blob), pulled out of SQLite and
// thrown away, since no `Book` field resolver reads it. These two tests
// prove the fix has both properties a query-count guard cannot: the blob is
// actually gone from the query, AND nothing that used to resolve now
// silently resolves `undefined` because a needed column was left out of the
// trimmed `select` by mistake.
describe('Library.entries — Book column selection', () => {
  // Property 1: the blob is gone from the query itself, not merely unread
  // off a row that still carries it. Asserting on the `select` object passed
  // to `prisma.book.findMany`, not on the returned row, catches a select
  // that fetches `coverData` anyway (e.g. a stray `coverData: true`) even if
  // no field resolver happens to touch it.
  it('selects the standalone book read without `coverData`, but still WITH a `select`', async () => {
    const bookSpy = vi.spyOn(harness.prisma.book, 'findMany');

    const result = await harness.execute(ENTRIES, { viewer: harness.aliceViewer });
    expect(result.errors).toBeUndefined();

    expect(bookSpy).toHaveBeenCalledTimes(1);
    const { select } = bookSpy.mock.calls[0][0] as { select?: Record<string, unknown> };
    // Not `undefined`: an unselected read (the pre-fix state) would also
    // "not select coverData" by this narrow a check, so the guard has to
    // pin down that a `select` is genuinely in force, not merely absent.
    expect(select).toBeDefined();
    expect(select).not.toHaveProperty('coverData');
  });

  // Property 2: every field the schema exposes on `Book` still resolves off
  // the selected row — the failure mode a query-count test, or even
  // property 1 above, would NOT catch: a `Book` field resolver silently
  // seeing `undefined` for a column left out of the trimmed `select`. Covers
  // every scalar/derived field in `graphql/schema/book/model.ts` that reads
  // directly off the row (title/author/etc., the `parse*`-derived array
  // fields, the epoch-to-`DateTime` fields, `hasCover`, and the
  // `urlSuffix`-built REST URLs) plus the two plain `userId`/`id`-keyed
  // fields with no extra fixture needed (`deviceEditionCount`,
  // `hasActionablePendingFix`) and the `seriesRel` relation
  // (`series`) — deliberately fetched through `Library.entries`, the one
  // read path this task's `select` actually touches, not through
  // `Library.book` (`t.prismaField`/`queryFromInfo`, a different read path
  // entirely — see `book/model.test.ts`).
  it('resolves every field the schema exposes on Book, sourced from the selected row', async () => {
    const bookId = 'f'.repeat(32);
    await harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id: bookId,
        title: 'Column Selection Probe',
        titleSort: 'column selection probe',
        author: 'A. Uthor',
        authorSort: 'uthor, a.',
        description: 'A book that exercises every Book field resolver.',
        publisher: 'Selection Press',
        publishDate: '2020-01-01',
        seriesId: 's-1', // the "Expanse" series seeded in beforeEach
        seriesIndex: 3,
        identifiers: '[{"scheme":"ISBN","value":"9780000000000"}]',
        subjects: '["Fantasy","Epic"]',
        coverMime: 'image/jpeg',
        coverData: Buffer.from('fake-cover-bytes'),
        size: 424242,
        mtime: 1_700_000_000_000,
        addedAt: 1_700_000_000_000,
        chapterCount: 3,
        chapterSpineMap: '[0,3,7]',
        chapterNames: '["One","Two","Three"]',
        pageCount: 250,
      },
    });

    const result = await harness.execute(
      `{ viewer { library { entries(first: 10, filter: { query: "Column Selection Probe" }) {
        edges { node { __typename ... on Book {
          documentId title titleSort author authorSort description publisher publishDate
          seriesIndex size pageCount chapterCount
          subjects identifiers { scheme value } chapterSpineMap chapterNames
          mtime addedAt
          hasCover coverUrl downloadUrl thumbnailUrl(width: 150)
          deviceEditionCount hasActionablePendingFix
          series { name }
        } } }
      } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const edges = (
      result.data as {
        viewer: {
          library: {
            entries: { edges: { node: Record<string, unknown> & { __typename: string } }[] };
          };
        };
      }
    ).viewer.library.entries.edges;
    // The filter's title match also pulls in the "Expanse" series itself
    // (`queryExpandsToSeriesBooks`, `library-page.ts`: a title query with no
    // `seriesName` filter also matches series whose member books match) —
    // isolate the `Book` edge this test actually cares about.
    const bookEdges = edges.filter((e) => e.node.__typename === 'Book');
    expect(bookEdges).toHaveLength(1);
    const book = bookEdges[0].node;

    expect(book).toEqual({
      __typename: 'Book',
      documentId: bookId,
      title: 'Column Selection Probe',
      titleSort: 'column selection probe',
      author: 'A. Uthor',
      authorSort: 'uthor, a.',
      description: 'A book that exercises every Book field resolver.',
      publisher: 'Selection Press',
      publishDate: '2020-01-01',
      seriesIndex: 3,
      size: 424242,
      pageCount: 250,
      chapterCount: 3,
      subjects: ['Fantasy', 'Epic'],
      identifiers: [{ scheme: 'ISBN', value: '9780000000000' }],
      chapterSpineMap: [0, 3, 7],
      chapterNames: ['One', 'Two', 'Three'],
      mtime: '2023-11-14T22:13:20.000Z',
      addedAt: '2023-11-14T22:13:20.000Z',
      hasCover: true,
      coverUrl: expect.stringContaining(bookId) as unknown as string,
      downloadUrl: expect.stringContaining(bookId) as unknown as string,
      thumbnailUrl: expect.stringContaining('150') as unknown as string,
      deviceEditionCount: 0,
      hasActionablePendingFix: false,
      series: { name: 'Expanse' },
    });
  });
});

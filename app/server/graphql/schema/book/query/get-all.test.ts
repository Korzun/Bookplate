import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

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
    edges { node { __typename ... on Book { title } ... on Series { name } } }
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
        edges: { node: Node }[];
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

  // `t.connection` always adds `last`/`before` to the SDL even though
  // `BookStore.listBooksPage` has no backward keyset to walk. Silently
  // ignoring them would mean a client asking for the trailing page instead
  // gets the leading page with no error — worse than not offering backward
  // pagination at all — so both must be rejected loudly with a coded error.
  it('rejects `last` instead of silently returning the leading page', async () => {
    const result = await harness.execute(
      '{ viewer { library { entries(last: 5) { edges { node { __typename } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]?.extensions?.code).toBe('BACKWARD_PAGINATION_UNSUPPORTED');
  });

  it('rejects `before` instead of silently returning the leading page', async () => {
    const result = await harness.execute(
      '{ viewer { library { entries(before: "some-opaque-cursor") { edges { node { __typename } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]?.extensions?.code).toBe('BACKWARD_PAGINATION_UNSUPPORTED');
  });

  // The parent `Book`/`Series` rows this connection resolves into are hand-
  // fetched via context.prisma.book.findMany()/series.findMany() outside the
  // Prisma plugin's own query planning, so a nested relation off a union
  // member (Series.books, itself a `t.relation`) takes the plugin's per-row
  // fallback path rather than a single planned join. Exercise it for real
  // rather than assuming the documented fallback behaviour holds here.
  it('resolves a nested relation (Series.books) through the union', async () => {
    const result = await harness.execute(
      `{ viewer { library { entries(first: 10) {
        edges { node { __typename ... on Series { name books { title } } } }
      } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const edges = (
      result.data as {
        viewer: {
          library: {
            entries: {
              edges: { node: { __typename: string; name?: string; books?: { title: string }[] } }[];
            };
          };
        };
      }
    ).viewer.library.entries.edges;
    const seriesEdge = edges.find((e) => e.node.__typename === 'Series');
    expect(seriesEdge?.node.books).toEqual([{ title: 'In Series' }]);
  });
});

import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

/**
 * `LibraryFilter` is mapped onto `BookListFilters` field by field, six times,
 * in `library/model.ts`. Every field is optional and three of them are plain
 * strings, so a swapped `author`/`seriesName` pair — adjacent lines, same
 * type — would produce plausible-looking wrong results and pass a suite that
 * only checked that filtering returns *something*.
 *
 * So each test here does two things: names the ONE entry the filter should
 * select, and picks fixture values such that feeding that argument to any
 * OTHER field of the input would select something different. The
 * author/seriesName pair is called out explicitly below, since it is the
 * swap most likely to happen and least likely to look wrong.
 */
let harness: Harness;

const SERIES_ID = 'series-arrakis';
const IN_SERIES = '1'.repeat(32);
const DUNE = '2'.repeat(32);
const NEUROMANCER = '3'.repeat(32);

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.series.create({
    data: {
      id: SERIES_ID,
      userId: harness.aliceOwner.userId,
      name: 'Expanse',
      sortKey: 'expanse',
      author: 'James Corey',
      subjects: JSON.stringify(['Space Opera']),
      bookCount: 1,
    },
  });
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: IN_SERIES,
      title: 'Leviathan Wakes',
      author: 'James Corey',
      series: 'Expanse',
      seriesId: SERIES_ID,
      subjects: JSON.stringify(['Space Opera']),
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: DUNE,
      title: 'Dune',
      author: 'Frank Herbert',
      subjects: JSON.stringify(['Desert']),
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: NEUROMANCER,
      title: 'Neuromancer',
      author: 'William Gibson',
      subjects: JSON.stringify(['Cyberpunk']),
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  // Neuromancer read to completion; nothing else has any progress.
  await harness.prisma.progress.create({
    data: {
      userId: harness.aliceOwner.userId,
      document: NEUROMANCER,
      progress: '/x',
      percentage: 1,
      device: 'Kobo',
      deviceId: 'dev-1',
      timestamp: 1_700_000_000,
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

const QUERY = `
  query ($filter: LibraryFilter) {
    viewer { library { entries(first: 50, filter: $filter) {
      edges { node { __typename ... on Book { title } ... on Series { name } } }
    } } }
  }
`;

type EntriesData = {
  viewer: {
    library: { entries: { edges: { node: { title?: string; name?: string } }[] } };
  };
};

/** The labels of the entries a filter selects, sorted for stable comparison. */
const labels = async (filter: Record<string, unknown> | undefined) => {
  const result = await harness.execute(QUERY, {
    viewer: harness.aliceViewer,
    variables: { filter },
  });
  expect(result.errors).toBeUndefined();
  return (result.data as EntriesData).viewer.library.entries.edges
    .map((e) => e.node.title ?? e.node.name ?? '')
    .sort();
};

const UNFILTERED = ['Dune', 'Expanse', 'Neuromancer'];

describe('LibraryFilter', () => {
  it('returns every top-level entry when no filter is given', async () => {
    // The baseline every case below must differ from. Without it, a filter
    // that silently did nothing would still look like it "returned results".
    expect(await labels(undefined)).toEqual(UNFILTERED);
  });

  it('query selects by title', async () => {
    expect(await labels({ query: 'Dune' })).toEqual(['Dune']);
  });

  /**
   * `author` and `seriesName` are the swap this file exists for: adjacent
   * lines in the mapping, both optional strings. The two fixture values are
   * chosen so a swap cannot pass — 'Frank Herbert' is no series' name, and
   * 'Expanse' is no book's author, so each argument arriving in the wrong
   * field selects nothing at all rather than the right thing by luck.
   */
  it('author selects by book/series author', async () => {
    expect(await labels({ author: 'Frank Herbert' })).toEqual(['Dune']);
  });

  it('seriesName selects the named series and excludes standalones', async () => {
    expect(await labels({ seriesName: 'Expanse' })).toEqual(['Expanse']);
  });

  it('does not accept an author as a seriesName, or vice versa', async () => {
    // The explicit anti-swap assertion. If the mapping crossed the two, one of
    // the two tests above would return this empty list instead.
    expect(await labels({ seriesName: 'Frank Herbert' })).toEqual([]);
    expect(await labels({ author: 'Expanse' })).toEqual([]);
  });

  it('status selects by reading progress', async () => {
    expect(await labels({ status: 'COMPLETED' })).toEqual(['Neuromancer']);
    // Two statuses, so the enum's value mapping is exercised in more than one
    // direction — a mapping that always sent the same string would pass with
    // only one case.
    expect(await labels({ status: 'NOT_STARTED' })).toEqual(['Dune', 'Expanse']);
  });

  it('subjects selects by subject', async () => {
    expect(await labels({ subjects: ['Desert'] })).toEqual(['Dune']);
  });

  it('entryType selects series or standalones', async () => {
    // Both enum members, and they partition the unfiltered list — so a mapping
    // that dropped `entryType` would fail both, and one that inverted it would
    // fail both too.
    expect(await labels({ entryType: 'SERIES' })).toEqual(['Expanse']);
    expect(await labels({ entryType: 'STANDALONE' })).toEqual(['Dune', 'Neuromancer']);
  });

  it('combines fields rather than letting the last one win', async () => {
    // Two fields at once, whose individual results are disjoint: only a
    // mapping that carries both through returns the intersection.
    expect(await labels({ entryType: 'STANDALONE', author: 'William Gibson' })).toEqual([
      'Neuromancer',
    ]);
  });
});

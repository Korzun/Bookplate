import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

/**
 * `SearchSuggestionsFilter`'s three fields are mapped one by one onto
 * `getSearchSuggestions`'s filter in `search-suggestions.ts`, and had no test
 * at all — a swapped `author`/`seriesName` (adjacent lines, both optional
 * strings) would return plausible suggestions and pass everything.
 *
 * Each field has a distinct, observable effect in the store, which is what
 * makes a swap detectable here:
 *   - `author` set   -> the *author* group is omitted entirely, and the book
 *                       and subject groups narrow to that exact author.
 *   - `seriesName` set -> the *series* group is omitted entirely, and the
 *                       book/subject groups narrow to that series.
 *   - `activeSubjects` -> those subjects are dropped from the subject group.
 * So a swap drops the wrong group, and the assertions below name which group
 * must disappear rather than merely counting them.
 */
let harness: Harness;

const SERIES_ID = 'series-arcadia';

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.series.create({
    data: {
      id: SERIES_ID,
      userId: harness.aliceOwner.userId,
      name: 'Arcadia',
      sortKey: 'arcadia',
      author: 'Arthur Clarke',
      bookCount: 1,
    },
  });
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: '1'.repeat(32),
      title: 'Arcadia One',
      author: 'Arthur Clarke',
      // The denormalized column the store's seriesName filter actually reads.
      series: 'Arcadia',
      seriesId: SERIES_ID,
      subjects: JSON.stringify(['Archaeology']),
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: '2'.repeat(32),
      title: 'Arrival',
      // No 'a' anywhere, so this author never matches the 'ar' subsequence and
      // the author group has exactly one member to lose.
      author: 'Boris Storm',
      subjects: JSON.stringify(['Astronomy']),
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

const QUERY = `
  query ($filter: SearchSuggestionsFilter) {
    viewer { library { searchSuggestions(query: "ar", filter: $filter) {
      type items { label }
    } } }
  }
`;

type SuggestionsData = {
  viewer: {
    library: { searchSuggestions: { type: string; items: { label: string }[] }[] };
  };
};

const suggest = async (filter: Record<string, unknown> | undefined) => {
  const result = await harness.execute(QUERY, {
    viewer: harness.aliceViewer,
    variables: { filter },
  });
  expect(result.errors).toBeUndefined();
  const groups = (result.data as SuggestionsData).viewer.library.searchSuggestions;
  return {
    types: groups.map((g) => g.type),
    labels: (type: string) => groups.find((g) => g.type === type)?.items.map((i) => i.label) ?? [],
  };
};

describe('SearchSuggestionsFilter', () => {
  it('offers author, series, book and subject groups when unfiltered', async () => {
    // The baseline every case below must differ from.
    const { types, labels } = await suggest(undefined);

    expect(types.sort()).toEqual(['author', 'book', 'series', 'subject']);
    expect(labels('author')).toEqual(['Arthur Clarke']);
    expect(labels('series')).toEqual(['Arcadia']);
    expect(labels('book').sort()).toEqual(['Arcadia One', 'Arrival']);
    expect(labels('subject').sort()).toEqual(['Archaeology', 'Astronomy']);
  });

  it('author drops the author group and narrows the rest to that author', async () => {
    const { types, labels } = await suggest({ author: 'Arthur Clarke' });

    // The AUTHOR group, specifically — a swap with seriesName would drop the
    // series group instead and leave this one standing.
    expect(types).not.toContain('author');
    expect(types).toContain('series');
    expect(labels('book')).toEqual(['Arcadia One']);
    expect(labels('subject')).toEqual(['Archaeology']);
  });

  it('seriesName drops the series group and narrows the rest to that series', async () => {
    const { types, labels } = await suggest({ seriesName: 'Arcadia' });

    // The SERIES group, specifically — the mirror image of the case above.
    expect(types).not.toContain('series');
    expect(types).toContain('author');
    expect(labels('book')).toEqual(['Arcadia One']);
    expect(labels('subject')).toEqual(['Archaeology']);
  });

  it('does not accept an author as a seriesName, or vice versa', async () => {
    // The explicit anti-swap assertion: each value in the wrong field narrows
    // to nothing, so neither test above could pass on a crossed mapping.
    const asSeries = await suggest({ seriesName: 'Arthur Clarke' });
    expect(asSeries.labels('book')).toEqual([]);

    const asAuthor = await suggest({ author: 'Arcadia' });
    expect(asAuthor.labels('book')).toEqual([]);
  });

  it('activeSubjects excludes already-selected subjects from the subject group', async () => {
    const { labels } = await suggest({ activeSubjects: ['Archaeology'] });

    // Only the already-selected one goes; the other stays. A filter that was
    // dropped would return both, one that over-applied would return neither.
    expect(labels('subject')).toEqual(['Astronomy']);
    // And it must not narrow the book group — activeSubjects is the store's
    // "exclude from suggestions" list, not a filter on entries.
    expect(labels('book').sort()).toEqual(['Arcadia One', 'Arrival']);
  });
});

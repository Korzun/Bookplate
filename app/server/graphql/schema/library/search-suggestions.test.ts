import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = '4'.repeat(32);

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
      title: 'Dune',
      author: 'Frank Herbert',
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Library.searchSuggestions', () => {
  it('returns grouped suggestions with match offsets', async () => {
    const result = await harness.execute(
      '{ viewer { library { searchSuggestions(query: "Dun") { type items { label value matchStart matchLength } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const groups = (
      result.data as { viewer: { library: { searchSuggestions: { type: string }[] } } }
    ).viewer.library.searchSuggestions;
    // Discriminating case for SuggestionType: stored 'book' must serialize as wire 'BOOK'.
    expect(groups.some((g) => g.type === 'BOOK')).toBe(true);
  });

  it('returns no groups for a blank query', async () => {
    const result = await harness.execute(
      '{ viewer { library { searchSuggestions(query: "  ") { type } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(
      (result.data as { viewer: { library: { searchSuggestions: unknown[] } } }).viewer.library
        .searchSuggestions
    ).toEqual([]);
  });

  it('does not suggest from another user library', async () => {
    const result = await harness.execute(
      '{ viewer { library { searchSuggestions(query: "Dun") { items { label } } } } }',
      { viewer: harness.bobViewer }
    );

    expect(
      (result.data as { viewer: { library: { searchSuggestions: unknown[] } } }).viewer.library
        .searchSuggestions
    ).toEqual([]);
  });
});

describe('Suggestion.book', () => {
  // Traced against `BookStore.getSearchSuggestions` (`book-store.ts`): only a
  // `BOOK`-typed group's `value` is the book's own content-hash id — this is
  // the one suggestion type `Suggestion.book` can resolve.
  it('resolves a BOOK-typed suggestion to the underlying Book', async () => {
    const result = await harness.execute(
      '{ viewer { library { searchSuggestions(query: "Dun") { type items { value book { id title } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const groups = (
      result.data as {
        viewer: {
          library: {
            searchSuggestions: {
              type: string;
              items: { value: string; book: { id: string; title: string } | null }[];
            }[];
          };
        };
      }
    ).viewer.library.searchSuggestions;
    const bookGroup = groups.find((g) => g.type === 'BOOK');
    expect(bookGroup?.items).toEqual([
      {
        value: BOOK_ID,
        book: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), title: 'Dune' },
      },
    ]);
  });

  // Honest no-op for every OTHER suggestion type: `author`/`series`/`subject`
  // values are label text, never a book id, so a naive lookup keyed on
  // `value` would be meaningless (and could even coincidentally match an
  // unrelated row). Isolated to a single SUBJECT group by a query string
  // that cannot subsequence-match the fixture's title or author.
  it('leaves book null for a non-BOOK suggestion type', async () => {
    await harness.prisma.book.update({
      where: { userId_id: { userId: harness.aliceOwner.userId, id: BOOK_ID } },
      data: { subjects: '["Mystery"]' },
    });

    const result = await harness.execute(
      '{ viewer { library { searchSuggestions(query: "myst") { type items { value book { id } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (
        result.data as {
          viewer: {
            library: {
              searchSuggestions: { type: string; items: { value: string; book: unknown }[] }[];
            };
          };
        }
      ).viewer.library.searchSuggestions
    ).toEqual([{ type: 'SUBJECT', items: [{ value: 'Mystery', book: null }] }]);
  });
});

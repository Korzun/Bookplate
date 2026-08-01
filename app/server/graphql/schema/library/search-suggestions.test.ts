import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: '4'.repeat(32),
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

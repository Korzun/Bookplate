import {
  deriveCurrentChapter,
  epochSecondsToDate,
  epochToDate,
  isLivePendingFix,
  parseIdentifiers,
  parseNullableStringArray,
  parseNumberArray,
  parsePendingFixState,
  parseStringArray,
} from './derive';

describe('parseIdentifiers', () => {
  it('parses a well-formed identifier array', () => {
    expect(parseIdentifiers('[{"scheme":"ISBN","value":"9780441013593"}]')).toEqual([
      { scheme: 'ISBN', value: '9780441013593' },
    ]);
  });

  it('returns an empty array for the default empty-array column value', () => {
    expect(parseIdentifiers('[]')).toEqual([]);
  });

  it('returns an empty array rather than throwing on malformed JSON', () => {
    expect(parseIdentifiers('{not json')).toEqual([]);
  });

  it('drops entries that are not shaped like an identifier', () => {
    expect(parseIdentifiers('[{"scheme":"ISBN","value":"1"},"nope",{"scheme":2}]')).toEqual([
      { scheme: 'ISBN', value: '1' },
    ]);
  });

  it('strips extra properties from identifiers', () => {
    expect(parseIdentifiers('[{"scheme":"ISBN","value":"1","debug":{"extra":"data"}}]')).toEqual([
      { scheme: 'ISBN', value: '1' },
    ]);
  });
});

describe('parseStringArray', () => {
  it('parses a subject list', () => {
    expect(parseStringArray('["Fantasy","Epic"]')).toEqual(['Fantasy', 'Epic']);
  });

  it('returns an empty array on malformed JSON', () => {
    expect(parseStringArray('nope')).toEqual([]);
  });

  it('drops non-string entries', () => {
    expect(parseStringArray('["Fantasy",7,null]')).toEqual(['Fantasy']);
  });
});

describe('parseNumberArray', () => {
  it('parses a chapter spine map', () => {
    expect(parseNumberArray('[0,3,7]')).toEqual([0, 3, 7]);
  });

  it('drops non-finite entries', () => {
    expect(parseNumberArray('[0,"x",null]')).toEqual([0]);
  });

  it('filters out Infinity from valid JSON overflow literals', () => {
    expect(parseNumberArray('[1e400]')).toEqual([]);
  });
});

describe('parseNullableStringArray', () => {
  it('returns null when the column is null', () => {
    expect(parseNullableStringArray(null)).toBeNull();
  });

  it('parses chapter names when present', () => {
    expect(parseNullableStringArray('["One","Two"]')).toEqual(['One', 'Two']);
  });
});

describe('epochToDate', () => {
  it('converts stored epoch milliseconds to a Date', () => {
    expect(epochToDate(1_700_000_000_000).toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });
});

describe('epochSecondsToDate', () => {
  it('converts stored epoch SECONDS to a Date', () => {
    expect(epochSecondsToDate(1_700_000_000).toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  // The whole reason this exists as a separate function: the same number put
  // through epochToDate lands in 1970. Pinned so a future "simplification"
  // that collapses the two has to delete this test to pass.
  it('disagrees with epochToDate on the same number, by a factor of 1000', () => {
    expect(epochSecondsToDate(1_700_000_000).getTime()).toBe(
      epochToDate(1_700_000_000).getTime() * 1000
    );
    expect(epochToDate(1_700_000_000).getUTCFullYear()).toBe(1970);
  });
});

describe('deriveCurrentChapter', () => {
  // Chapters start at spine indices 0, 3 and 6; parseCfiSpineIndex maps
  // /6/N to (N - 2) / 2, so /6/10 is spine index 4 — inside chapter 2.
  const spineMap = [0, 3, 6];
  const cfi = (n: number) => `EPUB_CFI(/6/${n * 2 + 2}!/4/2:0)`;

  it.each([
    [0, 1],
    [2, 1],
    [3, 2],
    [5, 2],
    [6, 3],
    [99, 3],
  ])('maps spine index %i to chapter %i', (spineIndex, chapter) => {
    expect(deriveCurrentChapter(cfi(spineIndex), spineMap)).toBe(chapter);
  });

  it('is null when the spine map is missing', () => {
    expect(deriveCurrentChapter(cfi(4), undefined)).toBeNull();
  });

  it('is null when the spine map is empty', () => {
    expect(deriveCurrentChapter(cfi(4), [])).toBeNull();
  });

  it("is null for KOReader's non-CFI progress form", () => {
    expect(deriveCurrentChapter('/body/DocFragment[3]', spineMap)).toBeNull();
  });

  it('is null for an empty progress string', () => {
    expect(deriveCurrentChapter('', spineMap)).toBeNull();
  });

  // A spine map whose first chapter starts after the reading position: no
  // chapter has begun yet, which spineIndexToChapter reports as null rather
  // than clamping to chapter 1.
  it('is null when the position precedes every chapter start', () => {
    expect(deriveCurrentChapter(cfi(0), [3, 6])).toBeNull();
  });
});

describe('parsePendingFixState', () => {
  const EMPTY = { autoFixes: [], appliedFixes: [], proposals: [], undo: null };

  const FIX = {
    field: 'title',
    kind: 'replace',
    from: 'Old Title',
    to: 'New Title',
    changes: { title: 'New Title' },
  };

  it('parses a well-formed state round-trip', () => {
    const json = JSON.stringify({
      autoFixes: [FIX],
      appliedFixes: [],
      proposals: [FIX],
      undo: { kind: 'apply', proposals: [FIX], appliedFixes: [] },
    });
    expect(parsePendingFixState(json)).toEqual({
      autoFixes: [FIX],
      appliedFixes: [],
      proposals: [FIX],
      undo: { kind: 'apply', proposals: [FIX], appliedFixes: [] },
    });
  });

  it('defaults every key to empty when the object has none of them', () => {
    expect(parsePendingFixState('{}')).toEqual(EMPTY);
  });

  it('returns the empty state rather than throwing on malformed JSON', () => {
    expect(parsePendingFixState('{not json')).toEqual(EMPTY);
  });

  it('returns the empty state for the JSON literal null', () => {
    expect(parsePendingFixState('null')).toEqual(EMPTY);
  });

  it('returns the empty state for a top-level JSON array', () => {
    expect(parsePendingFixState('[]')).toEqual(EMPTY);
  });

  it('drops array entries that are not shaped like a MetadataFix', () => {
    const json = JSON.stringify({ autoFixes: [FIX, 'nope', 42, null, { field: 'title' }] });
    expect(parsePendingFixState(json).autoFixes).toEqual([FIX]);
  });

  it('drops an undo snapshot whose kind is not apply/dismiss', () => {
    const json = JSON.stringify({ undo: { kind: 'oops', proposals: [], appliedFixes: [] } });
    expect(parsePendingFixState(json).undo).toBeNull();
  });

  // Not exposed on the GraphQL `UndoSnapshot` type (`undo-snapshot/model.ts`),
  // but `UNDO` (`book/mutation/resolve-pending-fix.ts`) reads it server-side
  // straight off this parser's output via `parsePendingFixState`, so it must
  // survive the round trip even though nothing here ever reads it back out
  // through GraphQL.
  it('round-trips an apply undo snapshot’s originalMetadata', () => {
    const originalMetadata = {
      title: 'Old Title',
      titleSort: '',
      author: 'Some Author',
      authorSort: '',
      subjects: ['Fiction'],
    };
    const json = JSON.stringify({
      undo: { kind: 'apply', proposals: [], appliedFixes: [], originalMetadata },
    });
    expect(parsePendingFixState(json).undo).toEqual({
      kind: 'apply',
      proposals: [],
      appliedFixes: [],
      originalMetadata,
    });
  });

  it('drops a non-object originalMetadata rather than throwing', () => {
    const json = JSON.stringify({
      undo: { kind: 'apply', proposals: [], appliedFixes: [], originalMetadata: 'nope' },
    });
    expect(parsePendingFixState(json).undo).toEqual({
      kind: 'apply',
      proposals: [],
      appliedFixes: [],
    });
  });

  // Beyond the listed cases: nonsense several levels deep must not throw, and
  // must degrade field-by-field rather than dropping the whole state.
  it('is total against deeply nested junk', () => {
    const json = JSON.stringify({
      autoFixes: [{ field: 1, kind: {}, from: [] }],
      proposals: 'not-an-array',
      undo: { kind: 'apply', proposals: 'nope', appliedFixes: [{ nonsense: true }] },
    });
    expect(parsePendingFixState(json)).toEqual({
      autoFixes: [],
      appliedFixes: [],
      proposals: [],
      undo: { kind: 'apply', proposals: [], appliedFixes: [] },
    });
  });

  it('defaults to/changes on a fix missing everything but the required strings', () => {
    const json = JSON.stringify({ autoFixes: [{ field: 'title', kind: 'replace', from: 'Old' }] });
    expect(parsePendingFixState(json).autoFixes).toEqual([
      { field: 'title', kind: 'replace', from: 'Old', to: null, changes: {} },
    ]);
  });

  it('keeps reason and chips when present and well-typed', () => {
    const fix = { ...FIX, reason: 'auto-normalized', fromChips: ['Old'], toChips: ['New'] };
    const json = JSON.stringify({ proposals: [fix] });
    expect(parsePendingFixState(json).proposals).toEqual([fix]);
  });
});

// The sole keep/drop rule for pending-fix rows since REST's delete-on-read
// reader (`BookStore.getPendingFixes`) was removed. TTL is 7 days, inlined
// here as a literal so this test does not import derive.ts's private
// module-level constant.
describe('isLivePendingFix', () => {
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const NOW = 1_700_000_000_000;

  const FIX = {
    field: 'title',
    kind: 'replace',
    from: 'Old Title',
    to: 'New Title',
    changes: {},
  };
  const UNDO = { kind: 'apply' as const, proposals: [], appliedFixes: [] };

  const EMPTY = { autoFixes: [], appliedFixes: [], proposals: [], undo: null };
  const withProposalsNoUndo = { ...EMPTY, proposals: [FIX] };
  const withProposalsAndUndo = { ...EMPTY, proposals: [FIX], undo: UNDO };
  const undoOnly = { ...EMPTY, undo: UNDO };

  it.each([
    ['no proposals, no undo — resolved', EMPTY, NOW, false],
    ['no proposals, undo present, not expired — live', undoOnly, NOW, true],
    ['proposals present, no undo — live', withProposalsNoUndo, NOW, true],
    ['proposals present, undo present — live', withProposalsAndUndo, NOW, true],
  ])('%s', (_name, state, updatedAt, expected) => {
    expect(isLivePendingFix(state, updatedAt, NOW)).toBe(expected);
  });

  it('is live when undo-only and updatedAt is exactly at the TTL boundary', () => {
    expect(isLivePendingFix(undoOnly, NOW - TTL_MS, NOW)).toBe(true);
  });

  it('is not live when undo-only and updatedAt is one ms past the TTL boundary', () => {
    expect(isLivePendingFix(undoOnly, NOW - TTL_MS - 1, NOW)).toBe(false);
  });

  it('is not live for a row whose state failed to parse (degrades to the empty state)', () => {
    expect(isLivePendingFix(parsePendingFixState('{not json'), NOW, NOW)).toBe(false);
  });
});

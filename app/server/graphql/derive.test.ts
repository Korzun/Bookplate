import {
  deriveCurrentChapter,
  epochSecondsToDate,
  epochToDate,
  parseIdentifiers,
  parseNullableStringArray,
  parseNumberArray,
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

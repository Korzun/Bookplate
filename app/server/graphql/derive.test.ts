import {
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

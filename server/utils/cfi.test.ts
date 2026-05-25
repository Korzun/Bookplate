import { parseCfiSpineIndex, spineIndexToChapter } from './cfi';

describe('parseCfiSpineIndex', () => {
  it('parses standard KoReader CFI format', () => {
    // /6/4 → (4-2)/2 = 1
    expect(parseCfiSpineIndex('EPUB_CFI(/6/4[ch1]!/4/2/1:0)')).toBe(1);
  });

  it('parses CFI for the first spine item', () => {
    // /6/2 → (2-2)/2 = 0
    expect(parseCfiSpineIndex('EPUB_CFI(/6/2!/4/1:0)')).toBe(0);
  });

  it('parses CFI for a later spine item', () => {
    // /6/10 → (10-2)/2 = 4
    expect(parseCfiSpineIndex('EPUB_CFI(/6/10[chapter5]!/4/2/1:0)')).toBe(4);
  });

  it('returns null for a non-EPUB_CFI string', () => {
    expect(parseCfiSpineIndex('/p[1]')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseCfiSpineIndex('')).toBeNull();
  });

  it('returns null for an odd N (invalid CFI element index)', () => {
    expect(parseCfiSpineIndex('EPUB_CFI(/6/3!/4/1:0)')).toBeNull();
  });

  it('returns null for N less than 2', () => {
    expect(parseCfiSpineIndex('EPUB_CFI(/6/0!/4/1:0)')).toBeNull();
  });
});

describe('spineIndexToChapter', () => {
  it('returns 1 when spine index matches first chapter exactly', () => {
    expect(spineIndexToChapter(1, [1, 3, 5])).toBe(1);
  });

  it('returns the correct chapter when spine index is within a chapter range', () => {
    // spine 4 is between ch2(3) and ch3(5), so chapter 2
    expect(spineIndexToChapter(4, [1, 3, 5])).toBe(2);
  });

  it('returns the last chapter when spine index is past the last entry', () => {
    expect(spineIndexToChapter(10, [1, 3, 5])).toBe(3);
  });

  it('returns null for an empty spine map', () => {
    expect(spineIndexToChapter(5, [])).toBeNull();
  });

  it('returns null when spine index is before the first chapter entry', () => {
    // spine 0 is before ch1(1)
    expect(spineIndexToChapter(0, [1, 3, 5])).toBeNull();
  });

  it('returns correct chapter with a single chapter', () => {
    expect(spineIndexToChapter(2, [2])).toBe(1);
    expect(spineIndexToChapter(5, [2])).toBe(1);
  });
});

import {
  normalizeForSearch,
  toSubsequenceLike,
  fuzzyScore,
  computeMatchWindow,
  scoreAndRank,
} from './fuzzy-search';

describe('normalizeForSearch', () => {
  it('lowercases and strips non-alphanumeric characters', () => {
    expect(normalizeForSearch('N. K. Jemisin')).toBe('nkjemisin');
  });

  it('strips punctuation from series names', () => {
    expect(normalizeForSearch('Teixcalaan')).toBe('teixcalaan');
  });

  it('handles empty string', () => {
    expect(normalizeForSearch('')).toBe('');
  });
});

describe('toSubsequenceLike', () => {
  it('inserts % between every character and at start/end', () => {
    expect(toSubsequenceLike('nkj')).toBe('%n%k%j%');
  });

  it('handles single character', () => {
    expect(toSubsequenceLike('a')).toBe('%a%');
  });

  it('returns bare % for empty string', () => {
    expect(toSubsequenceLike('')).toBe('%');
  });
});

describe('fuzzyScore', () => {
  it('returns 1.0 when normalised query is a substring of normalised candidate', () => {
    // "nkjemisin" contains "nkj" → exact normalised substring
    expect(fuzzyScore('nkj', 'nkjemisin')).toBe(1.0);
  });

  it('returns 1.0 for direct substring match', () => {
    expect(fuzzyScore('jemi', 'nkjemisin')).toBe(1.0);
  });

  it('returns a score between 0.4 and 1.0 for a near-miss typo (omitted char)', () => {
    // "texcalaan" is a subsequence of "teixcalaan" with tightness 9/10 → 0.85
    const score = fuzzyScore('texcalaan', 'teixcalaan');
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(1.0);
  });

  it('returns 0 when query chars are not a subsequence of the candidate', () => {
    expect(fuzzyScore('zzz', 'nkjemisin')).toBe(0);
  });

  it('returns 0 for empty query', () => {
    expect(fuzzyScore('', 'nkjemisin')).toBe(0);
  });

  it('scores tighter windows higher than sparse ones', () => {
    // "abc" in "abcxyz" is tight; "abc" in "axbxcxxx" is sparse
    const tightScore = fuzzyScore('abc', 'abcxyz');
    const sparseScore = fuzzyScore('abc', 'axbxcxxx');
    expect(tightScore).toBeGreaterThan(sparseScore);
  });
});

describe('computeMatchWindow', () => {
  it('finds exact substring in original label (case-insensitive)', () => {
    // "jemi" found contiguously starting at position 5 in "N.K. Jemisin"
    expect(computeMatchWindow('jemi', 'N.K. Jemisin')).toEqual({ matchStart: 5, matchLength: 4 });
  });

  it('spans from first to last matched char for initials query', () => {
    // "nkj" → N at 0, K at 2, J at 5 → span 0–5 = length 6
    expect(computeMatchWindow('nkj', 'N.K. Jemisin')).toEqual({ matchStart: 0, matchLength: 6 });
  });

  it('spans the whole word for a single-char-omission typo', () => {
    // query "texcalaan", label "Teixcalaan" — all chars found in order 0→9
    expect(computeMatchWindow('texcalaan', 'Teixcalaan')).toEqual({
      matchStart: 0,
      matchLength: 10,
    });
  });

  it('returns zero-length window when query chars are not found', () => {
    expect(computeMatchWindow('zzz', 'Jemisin')).toEqual({ matchStart: 0, matchLength: 0 });
  });
});

describe('scoreAndRank', () => {
  const items = [
    { label: 'Teixcalaan', value: 'Teixcalaan' },
    { label: 'N.K. Jemisin', value: 'N.K. Jemisin' },
    { label: 'Piranesi', value: 'Piranesi' },
  ];

  it('returns items matching the normalised query, sorted by score descending', () => {
    // "nkj" is exact normalised substring of "nkjemisin" (score 1.0)
    const result = scoreAndRank(items, 'nkj');
    expect(result.map((i) => i.value)).toContain('N.K. Jemisin');
    expect(result.map((i) => i.value)).not.toContain('Piranesi');
  });

  it('caps results at the specified limit', () => {
    const manyItems = Array.from({ length: 10 }, (_, i) => ({
      label: `Alpha Item ${i}`,
      value: `alpha-${i}`,
    }));
    expect(scoreAndRank(manyItems, 'alpha', 5).length).toBeLessThanOrEqual(5);
  });

  it('drops items that score 0', () => {
    const result = scoreAndRank(items, 'zzz');
    expect(result).toHaveLength(0);
  });
});

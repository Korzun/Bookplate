import { describe, it, expect } from 'vitest';

import { RATING_FIELDS, isRatingValue, formatRating, ratingOf } from './rating';

describe('isRatingValue', () => {
  it.each([1, 2, 3, 4, 5])('accepts %s', (n) => {
    expect(isRatingValue(n)).toBe(true);
  });

  it.each([0, 6, 2.5, -1, NaN, Infinity, '3', null, undefined])('rejects %s', (n) => {
    expect(isRatingValue(n)).toBe(false);
  });
});

describe('formatRating', () => {
  it.each([
    [1, 'Bad (1)'],
    [2, 'Okay (2)'],
    [3, 'Nice (3)'],
    [4, 'Great (4)'],
    [5, 'Awesome (5)'],
    [null, 'unrated'],
  ])('%s → %s', (value, out) => {
    expect(formatRating(value)).toBe(out);
  });
});

describe('ratingOf', () => {
  it('maps the five columns in field order', () => {
    expect(
      ratingOf({
        ratingOverall: 4,
        ratingStory: null,
        ratingCharacters: 5,
        ratingWriting: 2,
        ratingIdeas: null,
      })
    ).toEqual({ overall: 4, story: null, characters: 5, writing: 2, ideas: null });
  });

  it('keys follow RATING_FIELDS order', () => {
    const shape = ratingOf({
      ratingOverall: null,
      ratingStory: null,
      ratingCharacters: null,
      ratingWriting: null,
      ratingIdeas: null,
    });
    expect(Object.keys(shape)).toEqual([...RATING_FIELDS]);
  });
});

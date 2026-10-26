import { describe, expect, it } from 'vitest';

import { filterFromSearchParams, filterToSearchParams } from './use-book-list-filter';

describe('rating filter URL state', () => {
  it.each(['1', '2', '3', '4', '5'])('reads minOverall=%s', (s) => {
    expect(filterFromSearchParams(new URLSearchParams(`minOverall=${s}`)).minOverall).toBe(
      Number(s)
    );
  });

  it.each(['0', '6', '7', 'abc', '2.5'])('ignores minOverall=%s', (s) => {
    expect(
      filterFromSearchParams(new URLSearchParams(`minOverall=${s}`)).minOverall
    ).toBeUndefined();
  });

  it('reads unrated=1 and ignores any other value', () => {
    expect(filterFromSearchParams(new URLSearchParams('unrated=1')).unrated).toBe(true);
    for (const v of ['0', 'true', '']) {
      expect(filterFromSearchParams(new URLSearchParams(`unrated=${v}`)).unrated).toBeUndefined();
    }
  });

  it('round-trips minOverall and unrated through filterToSearchParams', () => {
    const filter = { minOverall: 4, unrated: true } as const;
    const params = filterToSearchParams(filter);
    expect(params.get('minOverall')).toBe('4');
    expect(params.get('unrated')).toBe('1');
    expect(filterFromSearchParams(params)).toEqual(filter);
    expect(filterToSearchParams({}).toString()).toBe('');
  });
});

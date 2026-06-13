import { describe, expect, it } from 'vitest';

import type { Book } from './type';
import { bookSort } from './util';

function makeBook(title: string): Book {
  return {
    id: title,
    title,
    author: 'Author',
    publisher: '',
    series: '',
    seriesIndex: 0,
    subjects: [],
    identifiers: [],
    hasCover: false,
    size: 0,
    addedAt: '2024-01-01',
    chapterCount: 0,
    pageCount: 0,
  };
}

describe('bookSort', () => {
  it('returns negative when title a comes before b', () => {
    expect(bookSort(makeBook('Apple'), makeBook('Banana'))).toBeLessThan(0);
  });

  it('returns positive when title a comes after b', () => {
    expect(bookSort(makeBook('Banana'), makeBook('Apple'))).toBeGreaterThan(0);
  });

  it('returns 0 for equal titles', () => {
    expect(bookSort(makeBook('Dune'), makeBook('Dune'))).toBe(0);
  });
});

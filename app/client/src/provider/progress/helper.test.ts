import { describe, expect, it } from 'vitest';

import type { Book } from '../book';
import { calculateSeriesProgressPercent } from './helper';
import type { UserProgressList } from './type';

function makeBook(id: string): Book {
  return {
    id,
    title: id,
    author: 'Author',
    titleSort: '',
    authorSort: '',
    publishDate: '',
    series: 'Series',
    seriesIndex: 0,
    subjects: [],
    identifiers: [],
    hasCover: false,
    size: 0,
    chapterCount: 0,
    pageCount: 0,
  };
}

function makeProgress(percentage: number): UserProgressList[string] {
  return { document: 'doc', percentage };
}

describe('calculateSeriesProgressPercent', () => {
  it('returns undefined when no books have progress', () => {
    const books = [makeBook('a'), makeBook('b')];
    const progressMap: UserProgressList = {};
    expect(calculateSeriesProgressPercent(books, progressMap)).toBeUndefined();
  });

  it('returns undefined when the book list is empty', () => {
    const progressMap: UserProgressList = { a: makeProgress(0.5) };
    expect(calculateSeriesProgressPercent([], progressMap)).toBeUndefined();
  });

  it('returns the percentage when only one book has progress', () => {
    const books = [makeBook('a'), makeBook('b')];
    const progressMap: UserProgressList = { a: makeProgress(0.8) };
    // avg = (0.8 + 0) / 2 = 0.4
    expect(calculateSeriesProgressPercent(books, progressMap)).toBe(0.4);
  });

  it('returns the average percentage across all books', () => {
    const books = [makeBook('a'), makeBook('b'), makeBook('c')];
    const progressMap: UserProgressList = {
      a: makeProgress(0.6),
      b: makeProgress(0.9),
      c: makeProgress(0.3),
    };
    // avg = (0.6 + 0.9 + 0.3) / 3 = 0.6
    expect(calculateSeriesProgressPercent(books, progressMap)).toBeCloseTo(0.6);
  });

  it('treats missing progress entries as 0% when at least one book has progress', () => {
    const books = [makeBook('a'), makeBook('b'), makeBook('c')];
    const progressMap: UserProgressList = { b: makeProgress(0.9) };
    // avg = (0 + 0.9 + 0) / 3 = 0.3
    expect(calculateSeriesProgressPercent(books, progressMap)).toBeCloseTo(0.3);
  });

  it('returns 1 when every book is 100% complete', () => {
    const books = [makeBook('a'), makeBook('b')];
    const progressMap: UserProgressList = {
      a: makeProgress(1),
      b: makeProgress(1),
    };
    expect(calculateSeriesProgressPercent(books, progressMap)).toBe(1);
  });

  it('returns 0 when the only progress entry has 0%', () => {
    const books = [makeBook('a')];
    const progressMap: UserProgressList = { a: makeProgress(0) };
    // The Progress object is truthy even when percentage is 0, so some() is true
    expect(calculateSeriesProgressPercent(books, progressMap)).toBe(0);
  });
});

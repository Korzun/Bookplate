import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Book } from '../type';

import type { UseBookList } from './use-book-list';
import { useSeriesBookList } from './use-series-book-list';

vi.mock('./use-book-list');

const { useBookList } = await import('./use-book-list');
const mockUseBookList = vi.mocked(useBookList);

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Title',
    author: 'Author',
    fileAs: '',
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
    ...overrides,
  };
}

function stubBookList(tuple: UseBookList) {
  mockUseBookList.mockReturnValue(tuple);
}

describe('useSeriesBookList', () => {
  it('propagates error state from useBookList', () => {
    stubBookList([[], false, true, 'fetch failed']);
    const { result } = renderHook(() => useSeriesBookList('Dune'));
    expect(result.current).toEqual([undefined, false, true, 'fetch failed']);
  });

  it('propagates error with undefined message', () => {
    stubBookList([[], false, true, undefined]);
    const { result } = renderHook(() => useSeriesBookList('Dune'));
    expect(result.current).toEqual([undefined, false, true, undefined]);
  });

  it('returns loading state when no books loaded yet', () => {
    stubBookList([[], true, false, undefined]);
    const { result } = renderHook(() => useSeriesBookList('Dune'));
    expect(result.current).toEqual([undefined, true, false, undefined]);
  });

  it('returns partial series books while still loading', () => {
    const books: Book[] = [
      makeBook({ id: '1', series: 'Dune', seriesIndex: 2 }),
      makeBook({ id: '2', series: 'Dune', seriesIndex: 1 }),
    ];
    stubBookList([books, true, false, undefined]);
    const { result } = renderHook(() => useSeriesBookList('Dune'));
    const [list, loading, error] = result.current;
    expect(loading).toBe(true);
    expect(error).toBe(false);
    expect(list?.map((b) => b.seriesIndex)).toEqual([1, 2]);
  });

  it('returns error when loading=true but other series exist and requested is missing', () => {
    const books: Book[] = [makeBook({ id: '1', series: 'Foundation', seriesIndex: 1 })];
    stubBookList([books, true, false, undefined]);
    const { result } = renderHook(() => useSeriesBookList('Dune'));
    expect(result.current).toEqual([undefined, false, true, 'Unknown series Dune']);
  });

  it('returns sorted books for known series when fully loaded', () => {
    const books: Book[] = [
      makeBook({ id: '3', series: 'Dune', seriesIndex: 3 }),
      makeBook({ id: '1', series: 'Dune', seriesIndex: 1 }),
      makeBook({ id: '2', series: 'Dune', seriesIndex: 2 }),
    ];
    stubBookList([books, false, false, undefined]);
    const { result } = renderHook(() => useSeriesBookList('Dune'));
    const [list, loading, error] = result.current;
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(list?.map((b) => b.seriesIndex)).toEqual([1, 2, 3]);
  });

  it('returns error for unknown series when fully loaded', () => {
    const books: Book[] = [makeBook({ id: '1', series: 'Foundation', seriesIndex: 1 })];
    stubBookList([books, false, false, undefined]);
    const { result } = renderHook(() => useSeriesBookList('Dune'));
    expect(result.current).toEqual([undefined, false, true, 'Unknown series Dune']);
  });

  it('excludes books with no series from series map', () => {
    const books: Book[] = [
      makeBook({ id: '1', series: '', seriesIndex: 0 }),
      makeBook({ id: '2', series: 'Dune', seriesIndex: 1 }),
    ];
    stubBookList([books, false, false, undefined]);
    const { result } = renderHook(() => useSeriesBookList('Dune'));
    expect(result.current[0]).toHaveLength(1);
  });
});

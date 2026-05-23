import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Book } from '../type';

import type { UseBookList } from './use-book-list';
import { useSeriesList } from './use-series-list';

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
    ...overrides,
  };
}

function stubList(tuple: UseBookList) {
  mockUseBookList.mockReturnValue(tuple);
}

describe('useSeriesList', () => {
  it('returns empty array when there are no books', () => {
    stubList([[], false, false, undefined]);
    const { result } = renderHook(() => useSeriesList());
    expect(result.current[0]).toEqual([]);
  });

  it('excludes books with no series', () => {
    stubList([[makeBook({ id: '1', series: '' })], false, false, undefined]);
    const { result } = renderHook(() => useSeriesList());
    expect(result.current[0]).toEqual([]);
  });

  it('groups books by series name', () => {
    stubList([
      [
        makeBook({ id: '1', series: 'Dune', seriesIndex: 1 }),
        makeBook({ id: '2', series: 'Foundation', seriesIndex: 1 }),
      ],
      false,
      false,
      undefined,
    ]);
    const { result } = renderHook(() => useSeriesList());
    expect(result.current[0]).toHaveLength(2);
  });

  it('sorts books within a series by seriesIndex ascending', () => {
    stubList([
      [
        makeBook({ id: '3', series: 'Dune', seriesIndex: 3 }),
        makeBook({ id: '1', series: 'Dune', seriesIndex: 1 }),
        makeBook({ id: '2', series: 'Dune', seriesIndex: 2 }),
      ],
      false,
      false,
      undefined,
    ]);
    const { result } = renderHook(() => useSeriesList());
    const [, books] = result.current[0][0];
    expect(books.map((b) => b.seriesIndex)).toEqual([1, 2, 3]);
  });

  it('sorts series entries alphabetically', () => {
    stubList([
      [
        makeBook({ id: '1', series: 'Foundation', seriesIndex: 1 }),
        makeBook({ id: '2', series: 'Dune', seriesIndex: 1 }),
      ],
      false,
      false,
      undefined,
    ]);
    const { result } = renderHook(() => useSeriesList());
    expect(result.current[0][0][0]).toBe('Dune');
    expect(result.current[0][1][0]).toBe('Foundation');
  });

  it('passes through loading state', () => {
    stubList([[], true, false, undefined]);
    const { result } = renderHook(() => useSeriesList());
    expect(result.current[1]).toBe(true);
    expect(result.current[2]).toBe(false);
  });

  it('passes through error state', () => {
    stubList([[], false, true, 'Fetch failed']);
    const { result } = renderHook(() => useSeriesList());
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Fetch failed');
  });
});

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';

import type { UseSeriesBookList } from '../../book/hook/use-series-book-list';

import type { UseMyProgressList } from './use-my-progress-list';
import { useMySeriesProgress } from './use-my-series-progress';

vi.mock('../../book/hook/use-series-book-list');
vi.mock('./use-my-progress-list');

const { useSeriesBookList } = await import('../../book/hook/use-series-book-list');
const { useMyProgressList } = await import('./use-my-progress-list');
const mockUseSeriesBookList = vi.mocked(useSeriesBookList);
const mockUseMyProgressList = vi.mocked(useMyProgressList);

function stubProgressList(tuple: UseMyProgressList) {
  mockUseMyProgressList.mockReturnValue(tuple);
}

function stubSeriesBookList(tuple: UseSeriesBookList) {
  mockUseSeriesBookList.mockReturnValue(tuple);
}

const BOOK_A = {
  id: 'a',
  title: 'Book A',
  author: 'Author',
  titleSort: '',
  authorSort: '',
  publishDate: '',
  series: 'Dune',
  seriesIndex: 1,
  subjects: [],
  identifiers: [],
  hasCover: false,
  size: 0,
  chapterCount: 0,
  pageCount: 0,
};

const BOOK_B = { ...BOOK_A, id: 'b', title: 'Book B', seriesIndex: 2 };

describe('useMySeriesProgress', () => {
  it('returns loading state when progress list is loading', () => {
    stubProgressList([undefined, true, false, undefined]);
    stubSeriesBookList([[BOOK_A, BOOK_B], false, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current).toEqual([undefined, true, false, undefined]);
  });

  it('returns loading state even when progress data already exists', () => {
    stubProgressList([{ a: { document: 'doc', percentage: 0.5 } }, true, false, undefined]);
    stubSeriesBookList([[BOOK_A, BOOK_B], false, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current).toEqual([undefined, true, false, undefined]);
  });

  it('returns error state with message when progress list has an error', () => {
    stubProgressList([undefined, false, true, 'User not logged in']);
    stubSeriesBookList([[BOOK_A, BOOK_B], false, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current).toEqual([undefined, false, true, 'User not logged in']);
  });

  it('returns error state without message when progress list has an unspecified error', () => {
    stubProgressList([undefined, false, true, undefined]);
    stubSeriesBookList([[BOOK_A, BOOK_B], false, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current).toEqual([undefined, false, true, undefined]);
  });

  it('returns initial state when progress list is undefined', () => {
    stubProgressList([undefined, false, false, undefined]);
    stubSeriesBookList([[BOOK_A, BOOK_B], false, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });

  it('returns initial state when series book list is undefined', () => {
    stubProgressList([{ a: { document: 'doc', percentage: 0.5 } }, false, false, undefined]);
    stubSeriesBookList([undefined, true, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    // Loading state from useSeriesBookList is not forwarded; undefined seriesBookList yields initial state
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });

  it('returns the calculated series progress when data is loaded', () => {
    stubProgressList([
      {
        a: { document: 'doc', percentage: 0.5 },
        b: { document: 'doc', percentage: 1.0 },
      },
      false,
      false,
      undefined,
    ]);
    stubSeriesBookList([[BOOK_A, BOOK_B], false, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    // avg = (0.5 + 1.0) / 2 = 0.75
    expect(result.current).toEqual([0.75, false, false, undefined]);
  });

  it('returns undefined progress when no books in the series have progress', () => {
    stubProgressList([{}, false, false, undefined]);
    stubSeriesBookList([[BOOK_A, BOOK_B], false, false, undefined]);
    const { result } = renderHook(() => useMySeriesProgress('Dune'));
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });

  it('passes the series name to useSeriesBookList', () => {
    stubProgressList([{}, false, false, undefined]);
    stubSeriesBookList([[BOOK_A, BOOK_B], false, false, undefined]);
    renderHook(() => useMySeriesProgress('Dune'));
    expect(mockUseSeriesBookList).toHaveBeenCalledWith('Dune');
  });
});

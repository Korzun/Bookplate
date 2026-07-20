import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { UseSeriesBookList } from '../../book/hook/use-series-book-list';

import type { UseUserProgressList } from './use-user-progress-list';
import { useUserSeriesProgress } from './use-user-series-progress';

vi.mock('./use-user-progress-list');
vi.mock('../../book/hook/use-series-book-list');

const { useUserProgressList } = await import('./use-user-progress-list');
const { useSeriesBookList } = await import('../../book/hook/use-series-book-list');
const mockUseUserProgressList = vi.mocked(useUserProgressList);
const mockUseSeriesBookList = vi.mocked(useSeriesBookList);

function stubProgress(tuple: UseUserProgressList) {
  mockUseUserProgressList.mockReturnValue(tuple);
}

function stubBooks(tuple: UseSeriesBookList) {
  mockUseSeriesBookList.mockReturnValue(tuple);
}

function makeBook(id: string, seriesIndex: number) {
  return {
    id,
    title: `Book ${id}`,
    author: 'Author',
    titleSort: '',
    authorSort: '',
    publishDate: '',
    publisher: '',
    series: 'TestSeries',
    seriesIndex,
    subjects: [],
    identifiers: [],
    hasCover: false,
    size: 0,
    addedAt: '2024-01-01',
    chapterCount: 0,
    pageCount: 0,
  };
}

describe('useUserSeriesProgress', () => {
  it('returns loading state when progress is loading', () => {
    stubProgress([undefined, true, false, undefined]);
    stubBooks([[makeBook('b1', 1)], false, false, undefined]);
    const { result } = renderHook(() => useUserSeriesProgress('alice', 'TestSeries'));
    expect(result.current).toEqual([undefined, true, false, undefined]);
  });

  it('returns error state when progress has an error', () => {
    stubProgress([undefined, false, true, 'Fetch failed']);
    stubBooks([[makeBook('b1', 1)], false, false, undefined]);
    const { result } = renderHook(() => useUserSeriesProgress('alice', 'TestSeries'));
    expect(result.current).toEqual([undefined, false, true, 'Fetch failed']);
  });

  it('returns error state without message when progress error has no message', () => {
    stubProgress([undefined, false, true, undefined]);
    stubBooks([[makeBook('b1', 1)], false, false, undefined]);
    const { result } = renderHook(() => useUserSeriesProgress('alice', 'TestSeries'));
    expect(result.current).toEqual([undefined, false, true, undefined]);
  });

  it('returns undefined when progress list is not yet loaded', () => {
    stubProgress([undefined, false, false, undefined]);
    stubBooks([[makeBook('b1', 1)], false, false, undefined]);
    const { result } = renderHook(() => useUserSeriesProgress('alice', 'TestSeries'));
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });

  it('returns initial state when series book list is not yet loaded', () => {
    // The hook only propagates the loading flag from useUserProgressList, not from
    // useSeriesBookList. When books are pending but progress is available, it falls
    // through to the undefined-check branch and returns the initial state.
    stubProgress([{ b1: { document: 'b1', percentage: 0.5 } }, false, false, undefined]);
    stubBooks([undefined, true, false, undefined]);
    const { result } = renderHook(() => useUserSeriesProgress('alice', 'TestSeries'));
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });

  it('returns undefined when no books in the series have progress', () => {
    stubProgress([{ other: { document: 'other', percentage: 0.5 } }, false, false, undefined]);
    stubBooks([[makeBook('b1', 1), makeBook('b2', 2)], false, false, undefined]);
    const { result } = renderHook(() => useUserSeriesProgress('alice', 'TestSeries'));
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });

  it('calculates the average series progress as a fraction', () => {
    stubProgress([
      {
        b1: { document: 'b1', percentage: 0.5 },
        b2: { document: 'b2', percentage: 1.0 },
      },
      false,
      false,
      undefined,
    ]);
    stubBooks([[makeBook('b1', 1), makeBook('b2', 2)], false, false, undefined]);
    const { result } = renderHook(() => useUserSeriesProgress('alice', 'TestSeries'));
    // avg = (0.5 + 1.0) / 2 = 0.75
    expect(result.current).toEqual([0.75, false, false, undefined]);
  });

  it('treats missing progress for a book as 0 when calculating the average', () => {
    stubProgress([{ b1: { document: 'b1', percentage: 1.0 } }, false, false, undefined]);
    stubBooks([[makeBook('b1', 1), makeBook('b2', 2)], false, false, undefined]);
    const { result } = renderHook(() => useUserSeriesProgress('alice', 'TestSeries'));
    // avg = (1.0 + 0) / 2 = 0.5
    expect(result.current).toEqual([0.5, false, false, undefined]);
  });

  it('returns the exact average fraction for non-integer averages', () => {
    stubProgress([
      {
        b1: { document: 'b1', percentage: 1 / 3 },
        b2: { document: 'b2', percentage: 1 / 3 },
        b3: { document: 'b3', percentage: 1 / 3 },
      },
      false,
      false,
      undefined,
    ]);
    stubBooks([[makeBook('b1', 1), makeBook('b2', 2), makeBook('b3', 3)], false, false, undefined]);
    const { result } = renderHook(() => useUserSeriesProgress('alice', 'TestSeries'));
    expect(result.current[0]).toBeCloseTo(1 / 3);
  });
});

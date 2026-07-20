import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';

import { useMyProgress } from './use-my-progress';
import type { UseMyProgressList } from './use-my-progress-list';

vi.mock('./use-my-progress-list');

const { useMyProgressList } = await import('./use-my-progress-list');
const mockUseMyProgressList = vi.mocked(useMyProgressList);

function stubList(tuple: UseMyProgressList) {
  mockUseMyProgressList.mockReturnValue(tuple);
}

describe('useMyProgress', () => {
  it('returns the progress entry for the given bookId when it exists', () => {
    stubList([{ 'book-1': { document: 'book-1', percentage: 60 } }, false, false, undefined]);
    const { result } = renderHook(() => useMyProgress('book-1'));
    expect(result.current).toEqual([
      { document: 'book-1', percentage: 60 },
      false,
      false,
      undefined,
    ]);
  });

  it('returns undefined when the bookId is not in the list', () => {
    stubList([{ 'book-1': { document: 'book-1', percentage: 60 } }, false, false, undefined]);
    const { result } = renderHook(() => useMyProgress('book-99'));
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });

  it('returns undefined with loading state when list is loading', () => {
    stubList([undefined, true, false, undefined]);
    const { result } = renderHook(() => useMyProgress('book-1'));
    expect(result.current).toEqual([undefined, true, false, undefined]);
  });

  it('returns the progress entry with loading state when list has data and is refreshing', () => {
    stubList([{ 'book-1': { document: 'book-1', percentage: 60 } }, true, false, undefined]);
    const { result } = renderHook(() => useMyProgress('book-1'));
    expect(result.current).toEqual([
      { document: 'book-1', percentage: 60 },
      true,
      false,
      undefined,
    ]);
  });

  it('returns error state with message from the list', () => {
    stubList([undefined, false, true, 'Failed to fetch progress']);
    const { result } = renderHook(() => useMyProgress('book-1'));
    expect(result.current).toEqual([undefined, false, true, 'Failed to fetch progress']);
  });

  it('returns error state without message from the list', () => {
    stubList([undefined, false, true, undefined]);
    const { result } = renderHook(() => useMyProgress('book-1'));
    expect(result.current).toEqual([undefined, false, true, undefined]);
  });

  it('returns undefined when list is undefined', () => {
    stubList([undefined, false, false, undefined]);
    const { result } = renderHook(() => useMyProgress('book-1'));
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });
});

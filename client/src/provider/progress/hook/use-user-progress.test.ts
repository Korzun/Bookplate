import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useUserProgress } from './use-user-progress';
import type { UseUserProgressList } from './use-user-progress-list';

vi.mock('./use-user-progress-list');

const { useUserProgressList } = await import('./use-user-progress-list');
const mockUseUserProgressList = vi.mocked(useUserProgressList);

function stubList(tuple: UseUserProgressList) {
  mockUseUserProgressList.mockReturnValue(tuple);
}

describe('useUserProgress', () => {
  it('returns the progress entry for the given bookId when it exists', () => {
    stubList([{ 'book-1': { document: 'book-1', percentage: 40 } }, false, false, undefined]);
    const { result } = renderHook(() => useUserProgress('alice', 'book-1'));
    expect(result.current).toEqual([
      { document: 'book-1', percentage: 40 },
      false,
      false,
      undefined,
    ]);
  });

  it('returns undefined when the bookId is not in the list', () => {
    stubList([{ 'book-1': { document: 'book-1', percentage: 40 } }, false, false, undefined]);
    const { result } = renderHook(() => useUserProgress('alice', 'book-99'));
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });

  it('returns undefined with loading state when list has no data yet', () => {
    stubList([undefined, true, false, undefined]);
    const { result } = renderHook(() => useUserProgress('alice', 'book-1'));
    expect(result.current).toEqual([undefined, true, false, undefined]);
  });

  it('returns the progress entry with loading state when list is refreshing', () => {
    stubList([{ 'book-1': { document: 'book-1', percentage: 40 } }, true, false, undefined]);
    const { result } = renderHook(() => useUserProgress('alice', 'book-1'));
    expect(result.current).toEqual([
      { document: 'book-1', percentage: 40 },
      true,
      false,
      undefined,
    ]);
  });

  it('returns error state with message', () => {
    stubList([undefined, false, true, 'Failed to fetch progress']);
    const { result } = renderHook(() => useUserProgress('alice', 'book-1'));
    expect(result.current).toEqual([undefined, false, true, 'Failed to fetch progress']);
  });

  it('returns error state without message', () => {
    stubList([undefined, false, true, undefined]);
    const { result } = renderHook(() => useUserProgress('alice', 'book-1'));
    expect(result.current).toEqual([undefined, false, true, undefined]);
  });

  it('returns undefined when list is not yet loaded', () => {
    stubList([undefined, false, false, undefined]);
    const { result } = renderHook(() => useUserProgress('alice', 'book-1'));
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });
});

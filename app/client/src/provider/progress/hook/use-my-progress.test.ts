import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

  // `page/book` passes `book?.id` (undefined until the book itself has
  // loaded) rather than the raw URL param — see that page's doc comment.
  // This is the "not loaded yet" shape for that gap, not a distinct error.
  //
  // Review round 1 (test gap): a list with only a NORMAL entry
  // (`'book-1'`) doesn't discriminate the `bookId === undefined` guard from
  // an accidental miss — plain-object indexing coerces a non-string key via
  // `String(undefined)`, so `myProgressList[undefined]` is really
  // `myProgressList['undefined']`, which misses that list too EVEN WITHOUT
  // the explicit guard. This version keys an entry under the literal
  // STRING `'undefined'`: without the guard, `myProgressList[bookId]` with
  // `bookId === undefined` would find THAT entry via coercion and return it
  // — so this only stays green with the guard actually in place.
  it('returns undefined without indexing the list when bookId is undefined, even when the list has an entry under the coerced key "undefined"', () => {
    stubList([
      {
        'book-1': { document: 'book-1', percentage: 60 },
        undefined: { document: 'undefined', percentage: 99 },
      },
      false,
      false,
      undefined,
    ]);
    const { result } = renderHook(() => useMyProgress(undefined));
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });
});

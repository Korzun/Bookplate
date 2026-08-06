import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApolloTestProvider } from '~/test-utils';

import { Context } from '../context';
import type { Book, BookList } from '../type';

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Title',
    author: 'Author',
    titleSort: '',
    authorSort: '',
    publishDate: '',
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

function makeWrapper(initialBooks: Book[] = [], initialCompleteIds: Set<string> = new Set()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>(
      Object.fromEntries(initialBooks.map((b) => [b.id, b]))
    );
    const [loadingByBookId, setLoadingByBookIdRaw] = useState<Record<string, boolean>>({});
    const [errorByBookId, setErrorByBookIdRaw] = useState<Record<string, string | undefined>>({});
    const [completeBookIds, setCompleteBookIdsRaw] = useState(initialCompleteIds);

    const setBookList = useCallback(
      (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
      []
    );
    const setLoadingForBook = useCallback((bookId: string, loading: boolean) => {
      setLoadingByBookIdRaw((prev) => ({ ...prev, [bookId]: loading }));
    }, []);
    const setErrorForBook = useCallback((bookId: string, error: string | undefined) => {
      setErrorByBookIdRaw((prev) => ({ ...prev, [bookId]: error }));
    }, []);
    const setBookComplete = useCallback((bookId: string) => {
      setCompleteBookIdsRaw((prev) => new Set([...prev, bookId]));
    }, []);

    return (
      <ApolloTestProvider>
        <Context.Provider
          value={{
            bookList,
            bookListFetched: true,
            bookListLoading: false,
            bookListError: undefined,
            loadingByBookId,
            errorByBookId,
            completeBookIds,
            setBookList,
            setBookListFetched: () => {},
            setBookListLoading: () => {},
            setBookListError: () => {},
            setLoadingForBook,
            setErrorForBook,
            setBookComplete,
            clearCompleteBookIds: () => {},
            bookListItems: [],
            nextCursor: null,
            setBookListItems: () => {},
            setNextCursor: () => {},
            bookListFilter: {},
            setBookListFilter: () => {},
          }}
        >
          {children}
        </Context.Provider>
      </ApolloTestProvider>
    );
  };
}

import { useBook } from './use-book';

describe('useBook', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('triggers fetch when book is absent from context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeBook({ id: '1' })),
      })
    );

    renderHook(() => useBook('1'), { wrapper: makeWrapper() });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/books/1', {}));
  });

  it('triggers fetch when book exists in context but is not complete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeBook({ id: '1' })),
      })
    );

    renderHook(() => useBook('1', true), {
      wrapper: makeWrapper([makeBook({ id: '1' })], new Set()),
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/books/1', {}));
  });

  it('does not trigger fetch when book exists and is complete', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    renderHook(() => useBook('1'), {
      wrapper: makeWrapper([makeBook({ id: '1' })], new Set(['1'])),
    });

    await act(async () => {});

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns summary data immediately before fetch starts for incomplete book', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    const book = makeBook({ id: '1', title: 'Dune' });
    const { result } = renderHook(() => useBook('1'), {
      wrapper: makeWrapper([book], new Set()),
    });

    const [returnedBook] = result.current;
    expect(returnedBook?.title).toBe('Dune');
  });

  it('triggers fetch when completeBook changes from false to true', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeBook({ id: '1' })),
    });
    vi.stubGlobal('fetch', mockFetch);

    const book = makeBook({ id: '1' });
    const { rerender } = renderHook(
      ({ complete }: { complete: boolean }) => useBook('1', complete),
      { wrapper: makeWrapper([book], new Set()), initialProps: { complete: false } }
    );

    // Book is in the list and completeBook=false — no fetch should fire
    expect(mockFetch).not.toHaveBeenCalled();

    // Changing to completeBook=true should trigger a fetch for the full data
    rerender({ complete: true });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/books/1', {}));
  });

  // Review round 1: `use-fetch-book.test.tsx` pins the mis-keying (root
  // cause), but not the actual symptom this hook produces from it — a
  // reviewer's probe against the pre-fix code hit 4438 fetches in 300ms and
  // climbing. `bookList[bookId] === undefined` (this hook's own effect
  // guard, above) never clears when `useFetchBook` stores the response
  // under `book.id` instead of the requested `bookId`: `setBookList` mints
  // a fresh object identity every time regardless, re-arming the effect on
  // every resulting render, and `loadingByBookId` is already back to
  // `false` by the time it re-fires, so the re-entrancy guard inside
  // `useFetchBook` doesn't catch it either. This pins the bounded-call-count
  // symptom directly, the way the reviewer's own probe did.
  //
  // Review round 2 (minor): against the unfixed code this doesn't fail a
  // count assertion — the loop just keeps firing async setState/fetch
  // cycles until vitest's default 5000ms test timeout kills it, which reads
  // as a hang, not a regression. This hook's own loop is
  // fetch-then-setState-then-refire (not a synchronous render loop), so it
  // never trips React's own "Maximum update depth exceeded" guard the way a
  // synchronous update loop would — it just keeps going. The explicit 2000ms
  // timeout below (comfortably above the ~200ms the fixed case takes) makes
  // a regression fail fast and legibly instead of reading as a hang.
  it('fetches exactly once when the requested id differs from the response book.id (global-id navigation), not in a loop', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeBook({ id: 'raw-1' })),
    });
    vi.stubGlobal('fetch', mockFetch);

    renderHook(() => useBook('global-1', true), { wrapper: makeWrapper() });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    // Give a runaway effect a real window to keep firing before asserting
    // the count stayed put — a `waitFor` alone only proves the FIRST call
    // happened, not that it stopped there.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  }, 2000);
});

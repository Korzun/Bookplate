import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList } from '../type';

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
        }}
      >
        {children}
      </Context.Provider>
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
});

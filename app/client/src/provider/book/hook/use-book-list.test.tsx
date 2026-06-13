import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LibraryTargetProvider, useLibraryTarget } from '~/provider/library-target';

import { Context } from '../context';
import type { Book, BookList } from '../type';

import { useBookList } from './use-book-list';

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

function makeWrapper({
  initialBooks = {} as BookList,
  bookListFetched = false,
  bookListLoading = false,
  bookListError = undefined as string | undefined,
} = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>(initialBooks);
    const [fetched, setFetched] = useState(bookListFetched);
    const [loading, setLoading] = useState(bookListLoading);
    const [error, setError] = useState<string | undefined>(bookListError);
    const setBookList = useCallback(
      (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
      []
    );
    return (
      <Context.Provider
        value={{
          bookList,
          bookListFetched: fetched,
          bookListLoading: loading,
          bookListError: error,
          loadingByBookId: {},
          errorByBookId: {},
          completeBookIds: new Set(),
          setBookList,
          setBookListFetched: setFetched,
          setBookListLoading: setLoading,
          setBookListError: setError,
          setLoadingForBook: () => {},
          setErrorForBook: () => {},
          setBookComplete: () => {},
          clearCompleteBookIds: () => {},
          bookListItems: [],
          nextCursor: null,
          setBookListItems: () => {},
          setNextCursor: () => {},
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

describe('useBookList', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('triggers a fetch when bookListFetched is false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [], books: [], nextCursor: null }),
      })
    );
    renderHook(() => useBookList(), { wrapper: makeWrapper() });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/books?take=20', {}));
  });

  it('does not fetch when bookListFetched is already true', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    renderHook(() => useBookList(), { wrapper: makeWrapper({ bookListFetched: true }) });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch while bookListLoading is true', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    renderHook(() => useBookList(), { wrapper: makeWrapper({ bookListLoading: true }) });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns books sorted alphabetically by title', () => {
    vi.stubGlobal('fetch', vi.fn());
    const books: BookList = {
      '1': makeBook({ id: '1', title: 'Zoe' }),
      '2': makeBook({ id: '2', title: 'Apple' }),
      '3': makeBook({ id: '3', title: 'Mango' }),
    };
    const { result } = renderHook(() => useBookList(), {
      wrapper: makeWrapper({ initialBooks: books, bookListFetched: true }),
    });
    expect(result.current[0].map((b) => b.title)).toEqual(['Apple', 'Mango', 'Zoe']);
  });

  it('passes through loading state', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { result } = renderHook(() => useBookList(), {
      wrapper: makeWrapper({ bookListLoading: true }),
    });
    expect(result.current[1]).toBe(true);
    expect(result.current[2]).toBe(false);
  });

  it('passes through error state', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { result } = renderHook(() => useBookList(), {
      wrapper: makeWrapper({ bookListError: 'Failed to fetch books', bookListFetched: true }),
    });
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Failed to fetch books');
  });

  it('clears a previous error and refetches when the library target changes', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [], books: [], nextCursor: null }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const ContextWrapper = makeWrapper({
      bookListFetched: true,
      bookListError: 'Failed to fetch books',
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LibraryTargetProvider>
        <ContextWrapper>{children}</ContextWrapper>
      </LibraryTargetProvider>
    );
    const { result } = renderHook(() => ({ list: useBookList(), target: useLibraryTarget() }), {
      wrapper,
    });

    // Fetched with a standing error: the trigger effect must stay blocked.
    expect(mockFetch).not.toHaveBeenCalled();

    act(() => result.current.target[1]('alice'));

    // The target change clears the error and unfetched state, letting the
    // trigger effect refetch with a callback built after the reset.
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/books?take=20', {}));
    await waitFor(() => expect(result.current.list[2]).toBe(false));
  });
});

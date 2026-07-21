import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList, BookListFilter, DisplayUnit, PagedBookListResponse } from '../type';
import { useFetchNextPage } from './use-fetch-next-page';

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
    chapterCount: 0,
    pageCount: 0,
    ...overrides,
  };
}

function makeWrapper({
  nextCursor = null as string | null,
  bookListLoading = false,
  initialBooks = {} as BookList,
  initialItems = [] as DisplayUnit[],
  bookListFilter = {} as BookListFilter,
  onSetBookList = vi.fn(),
  onSetBookListItems = vi.fn(),
  onSetNextCursor = vi.fn(),
  onSetBookListError = vi.fn(),
} = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>(initialBooks);
    const [items, setItemsRaw] = useState<DisplayUnit[]>(initialItems);
    const [loading, setLoading] = useState(bookListLoading);
    const setBookList = useCallback((updater: (prev: BookList) => BookList) => {
      setBookListRaw((prev) => {
        const next = updater(prev);
        onSetBookList(next);
        return next;
      });
    }, []);
    const setBookListItems = useCallback((updater: (prev: DisplayUnit[]) => DisplayUnit[]) => {
      setItemsRaw((prev) => {
        const next = updater(prev);
        onSetBookListItems(next);
        return next;
      });
    }, []);
    return (
      <Context.Provider
        value={{
          bookList,
          bookListFetched: true,
          bookListLoading: loading,
          bookListError: undefined,
          loadingByBookId: {},
          errorByBookId: {},
          completeBookIds: new Set(),
          bookListItems: items,
          nextCursor,
          setBookList,
          setBookListFetched: () => {},
          setBookListLoading: (v) => setLoading(v),
          setBookListError: onSetBookListError,
          setLoadingForBook: () => {},
          setErrorForBook: () => {},
          setBookComplete: () => {},
          clearCompleteBookIds: () => {},
          setBookListItems,
          setNextCursor: onSetNextCursor,
          bookListFilter,
          setBookListFilter: () => {},
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

describe('useFetchNextPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does nothing when nextCursor is null', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: null }),
    });
    await act(() => result.current());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does nothing when already loading', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: 'abc==', bookListLoading: true }),
    });
    await act(() => result.current());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches with the cursor URL-encoded', async () => {
    const cursor = btoa('Book B');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<PagedBookListResponse> =>
          Promise.resolve({ items: [], books: [], nextCursor: null }),
      })
    );
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: cursor }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith(
      `/api/books?cursor=${encodeURIComponent(cursor)}&take=20`,
      {}
    );
  });

  it('appends new items to bookListItems', async () => {
    const cursor = btoa('Book A');
    const newBook = makeBook({ id: 'b2', title: 'Book B' });
    const onSetBookListItems = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<PagedBookListResponse> =>
          Promise.resolve({
            items: [{ type: 'standalone', bookId: 'b2' }],
            books: [newBook],
            nextCursor: null,
          }),
      })
    );
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({
        nextCursor: cursor,
        initialItems: [{ type: 'standalone', bookId: 'b1' }],
        onSetBookListItems,
      }),
    });
    await act(() => result.current());
    expect(onSetBookListItems).toHaveBeenCalledWith([
      { type: 'standalone', bookId: 'b1' },
      { type: 'standalone', bookId: 'b2' },
    ]);
  });

  it('updates nextCursor with the value from the response', async () => {
    const cursor = btoa('Book A');
    const nextCursorFromServer = btoa('Book B');
    const onSetNextCursor = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<PagedBookListResponse> =>
          Promise.resolve({ items: [], books: [], nextCursor: nextCursorFromServer }),
      })
    );
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: cursor, onSetNextCursor }),
    });
    await act(() => result.current());
    expect(onSetNextCursor).toHaveBeenCalledWith(nextCursorFromServer);
  });

  it('sets error on non-ok response', async () => {
    const cursor = btoa('X');
    const onSetBookListError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: cursor, onSetBookListError }),
    });
    await act(() => result.current());
    expect(onSetBookListError).toHaveBeenCalledWith('Failed to fetch books');
  });

  it('appends type filter param to next-page URL', async () => {
    const cursor = btoa('Book A');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<PagedBookListResponse> =>
          Promise.resolve({ items: [], books: [], nextCursor: null }),
      })
    );
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: cursor, bookListFilter: { seriesName: 'My Series' } }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith(
      `/api/books?cursor=${encodeURIComponent(cursor)}&seriesName=My+Series&take=20`,
      {}
    );
  });

  it('appends status filter param to next-page URL', async () => {
    const cursor = btoa('Book A');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<PagedBookListResponse> =>
          Promise.resolve({ items: [], books: [], nextCursor: null }),
      })
    );
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: cursor, bookListFilter: { status: 'completed' } }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith(
      `/api/books?cursor=${encodeURIComponent(cursor)}&status=completed&take=20`,
      {}
    );
  });
});

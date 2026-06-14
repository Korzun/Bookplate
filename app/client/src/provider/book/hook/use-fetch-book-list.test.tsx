import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList, BookListFilter, DisplayUnit, PagedBookListResponse } from '../type';

import { useFetchBookList } from './use-fetch-book-list';

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

function makeResponse(books: Book[], nextCursor: string | null = null): PagedBookListResponse {
  return {
    items: books.map((b) => ({ type: 'standalone' as const, bookId: b.id })),
    books,
    nextCursor,
  };
}

function makeWrapper({
  initialBooks = {} as BookList,
  bookListLoading = false,
  completeBookIds = new Set<string>(),
  onSetBookList = (_: BookList) => {},
  onSetBookListFetched = vi.fn(),
  onSetBookListError = vi.fn(),
  onSetBookListItems = vi.fn(),
  onSetNextCursor = vi.fn(),
  bookListFilter = {} as BookListFilter,
} = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>(initialBooks);
    const [loading, setLoading] = useState(bookListLoading);
    const [bookListItems, setBookListItemsRaw] = useState<DisplayUnit[]>([]);
    const setBookList = useCallback((updater: (prev: BookList) => BookList) => {
      setBookListRaw((prev) => {
        const next = updater(prev);
        onSetBookList(next);
        return next;
      });
    }, []);
    const setBookListItems = useCallback((updater: (prev: DisplayUnit[]) => DisplayUnit[]) => {
      setBookListItemsRaw((prev) => {
        const next = updater(prev);
        onSetBookListItems(next);
        return next;
      });
    }, []);
    return (
      <Context.Provider
        value={{
          bookList,
          bookListFetched: false,
          bookListLoading: loading,
          bookListError: undefined,
          loadingByBookId: {},
          errorByBookId: {},
          completeBookIds,
          bookListItems,
          nextCursor: null,
          setBookList,
          setBookListFetched: onSetBookListFetched,
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

describe('useFetchBookList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches GET /api/books?take=20', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), { wrapper: makeWrapper() });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith('/api/books?take=20', {});
  });

  it('sets bookListFetched to true on success', async () => {
    const onSetBookListFetched = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ onSetBookListFetched }),
    });
    await act(() => result.current());
    expect(onSetBookListFetched).toHaveBeenCalledWith(true);
  });

  it('populates bookListItems with the items array from the response', async () => {
    const book = makeBook({ id: '1', title: 'Dune' });
    const onSetBookListItems = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([book])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ onSetBookListItems }),
    });
    await act(() => result.current());
    expect(onSetBookListItems).toHaveBeenCalledWith([{ type: 'standalone', bookId: '1' }]);
  });

  it('sets nextCursor from the response', async () => {
    const onSetNextCursor = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([], 'abc==')),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ onSetNextCursor }),
    });
    await act(() => result.current());
    expect(onSetNextCursor).toHaveBeenCalledWith('abc==');
  });

  it('merges response books into bookList dict', async () => {
    const books = [makeBook({ id: '1', title: 'Dune' })];
    const onSetBookList = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse(books)),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ onSetBookList }),
    });
    await act(() => result.current());
    expect(onSetBookList).toHaveBeenCalledWith(
      expect.objectContaining({ '1': expect.objectContaining({ title: 'Dune' }) })
    );
  });

  it('preserves complete book data for books already in completeBookIds', async () => {
    const existing = makeBook({ id: '1', title: 'Full Dune', author: 'Herbert' });
    const serverBook = makeBook({ id: '1', title: 'Partial Dune' });
    const onSetBookList = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([serverBook])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({
        initialBooks: { '1': existing },
        completeBookIds: new Set(['1']),
        onSetBookList,
      }),
    });
    await act(() => result.current());
    expect(onSetBookList).toHaveBeenCalledWith({ '1': existing });
  });

  it('sets error message on non-ok response', async () => {
    const onSetBookListError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ onSetBookListError }),
    });
    await act(() => result.current());
    expect(onSetBookListError).toHaveBeenCalledWith('Failed to fetch books');
  });

  it('bails early when bookListLoading is already true', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ bookListLoading: true }),
    });
    await act(() => result.current());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('appends type filter param to URL when bookListFilter.type is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ bookListFilter: { type: 'series' } }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith('/api/books?type=series&take=20', {});
  });

  it('appends status filter param to URL when bookListFilter.status is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ bookListFilter: { status: 'in-progress' } }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith('/api/books?status=in-progress&take=20', {});
  });

  it('omits filter params when bookListFilter is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ bookListFilter: {} }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith('/api/books?take=20', {});
  });
});

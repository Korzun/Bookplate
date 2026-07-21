import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeJwt } from '~/lib/test-jwt';
import { setToken } from '~/lib/token';
import { AuthProvider } from '~/provider/auth';
import { LibraryTargetProvider, useLibraryTarget } from '~/provider/library-target';

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

function seedAdmin() {
  setToken(
    makeJwt({
      username: 'admin',
      isAdmin: true,
      mustChangePassword: false,
      exp: Math.floor(Date.now() / 1000) + 900,
    })
  );
}

function makeAdminWrapper(bookCtxOverrides: Parameters<typeof makeWrapper>[0] = {}) {
  const BookWrapper = makeWrapper(bookCtxOverrides);
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthProvider>
        <LibraryTargetProvider>
          <BookWrapper>{children}</BookWrapper>
        </LibraryTargetProvider>
      </AuthProvider>
    );
  };
}

describe('useFetchBookList', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

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

  it('appends query filter param to URL when bookListFilter.query is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ bookListFilter: { query: 'test' } }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith('/api/books?query=test&take=20', {});
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

  it('appends subjects filter params to URL when bookListFilter.subjects is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ bookListFilter: { subjects: ['Fantasy', 'Adventure'] } }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith(
      '/api/books?subjects=Fantasy&subjects=Adventure&take=20',
      {}
    );
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

  it('appends entryType filter param to URL when bookListFilter.entryType is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ bookListFilter: { entryType: 'series' } }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith('/api/books?entryType=series&take=20', {});
  });

  it('clears the target selection when the server 404s for a missing user', async () => {
    seedAdmin();
    localStorage.setItem('library-target-user', 'ghost');
    const onSetBookListError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { result } = renderHook(
      () => ({ fetchBookList: useFetchBookList(), target: useLibraryTarget() }),
      { wrapper: makeAdminWrapper({ onSetBookListError }) }
    );
    expect(result.current.target[0]).toBe('ghost');

    await act(() => result.current.fetchBookList());

    expect(result.current.target[0]).toBeUndefined();
    expect(localStorage.getItem('library-target-user')).toBeNull();
    expect(onSetBookListError).not.toHaveBeenCalledWith('Failed to fetch books');
  });

  it('still surfaces an error for a non-404 failure when a target is selected', async () => {
    seedAdmin();
    localStorage.setItem('library-target-user', 'alice');
    const onSetBookListError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { result } = renderHook(
      () => ({ fetchBookList: useFetchBookList(), target: useLibraryTarget() }),
      { wrapper: makeAdminWrapper({ onSetBookListError }) }
    );

    await act(() => result.current.fetchBookList());

    expect(result.current.target[0]).toBe('alice');
    expect(onSetBookListError).toHaveBeenCalledWith('Failed to fetch books');
  });
});

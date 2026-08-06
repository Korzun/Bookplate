import type { MockedResponse } from '@apollo/client/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserListDocument } from '~/graphql/user';
import { makeJwt } from '~/lib/test-jwt';
import { setToken } from '~/lib/token';
import { AuthProvider } from '~/provider/auth';
import {
  LibraryTargetProvider,
  useLibraryTarget,
  useWithTargetUser,
} from '~/provider/library-target';
import { ApolloTestProvider } from '~/test-utils';

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

/**
 * `apolloMocks` defaults to empty — every non-admin test in this file (the
 * vast majority) never lets `useWithTargetUser`'s query fire (`skip:
 * !isAdmin`), so an empty `MockLink` never needs a matching mock. It exists
 * as a param (not a second, nested `ApolloTestProvider`) so `makeAdminWrapper`
 * below can supply a REAL mock through the SAME, single `ApolloProvider` —
 * nesting a second one around this wrapper's output would just shadow it,
 * since `useQuery` always reads the NEAREST `ApolloProvider` ancestor.
 */
function makeWrapper({
  initialBooks = {} as BookList,
  bookListLoading = false,
  completeBookIds = new Set<string>(),
  onSetBookList = (_: BookList) => {},
  onSetBookListFetched = vi.fn(),
  onSetBookListError = vi.fn(),
  onSetBookListItems = vi.fn(),
  bookListFilter = {} as BookListFilter,
  apolloMocks = [] as MockedResponse[],
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
      <ApolloTestProvider mocks={apolloMocks}>
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
            setBookList,
            setBookListFetched: onSetBookListFetched,
            setBookListLoading: (v) => setLoading(v),
            setBookListError: onSetBookListError,
            setLoadingForBook: () => {},
            setErrorForBook: () => {},
            setBookComplete: () => {},
            clearCompleteBookIds: () => {},
            setBookListItems,
            bookListFilter,
            setBookListFilter: () => {},
          }}
        >
          {children}
        </Context.Provider>
      </ApolloTestProvider>
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

/**
 * `apolloMocks` defaults to a `UserListDocument` response that resolves to
 * no users — enough for `useWithTargetUser`'s query to settle (`ready`
 * becomes `true`) without matching any library id, which is all the two
 * admin tests below need (they exercise 404/500 handling, not username
 * resolution).
 */
function makeAdminWrapper(
  bookCtxOverrides: Omit<NonNullable<Parameters<typeof makeWrapper>[0]>, 'apolloMocks'> = {},
  apolloMocks: MockedResponse[] = [
    {
      request: { query: UserListDocument },
      result: {
        data: { __typename: 'Query', viewer: { __typename: 'Viewer', users: [] } },
      },
    },
  ]
) {
  const BookWrapper = makeWrapper({ ...bookCtxOverrides, apolloMocks });
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

  /** A `UserListDocument` mock with exactly one user, owning `libraryId`. */
  const matchingUserListMock = (username: string, libraryId: string): MockedResponse => ({
    request: { query: UserListDocument },
    result: {
      data: {
        __typename: 'Query',
        viewer: {
          __typename: 'Viewer',
          users: [
            {
              __typename: 'User',
              id: 'u1',
              username,
              progressCount: 0,
              library: { __typename: 'Library', id: libraryId },
            },
          ],
        },
      },
    },
  });

  // Round-2 review (the 400-latch finding): once `withTargetUser` settles
  // with NO matching username, a request built from it can never carry
  // `?user=` and the server would 400 it — so this clears the selection
  // BEFORE ever attempting a fetch, rather than waiting for that 400 to
  // surface as a permanent `bookListError`. `makeAdminWrapper`'s DEFAULT
  // mock (`users: []`) is exactly this "settled, no match" state.
  it('clears the target selection when the resolved user list has no match, without ever fetching', async () => {
    seedAdmin();
    localStorage.setItem('library-target-id', 'LIB-GHOST');
    const onSetBookListError = vi.fn();
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(
      () => ({
        fetchBookList: useFetchBookList(),
        target: useLibraryTarget(),
        withTargetUser: useWithTargetUser(),
      }),
      { wrapper: makeAdminWrapper({ onSetBookListError }) }
    );
    expect(result.current.target[0]).toBe('LIB-GHOST');

    await waitFor(() => expect(result.current.withTargetUser.ready).toBe(true));
    expect(result.current.withTargetUser.username).toBeUndefined();

    await act(() => result.current.fetchBookList());

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.target[0]).toBeUndefined();
    expect(localStorage.getItem('library-target-id')).toBeNull();
    expect(onSetBookListError).not.toHaveBeenCalledWith('Failed to fetch books');
  });

  // The pre-emptive guard above only fires when the CLIENT never resolved a
  // match. This test pins the remaining, genuinely different case: the
  // client DID resolve one (a real `?user=` request goes out), but the
  // server still 404s it — the owner was deleted server-side after this
  // admin's `UserListDocument` was fetched but before the cache refreshed.
  it('clears the target selection when the server 404s a request built from a resolved (now stale) username', async () => {
    seedAdmin();
    localStorage.setItem('library-target-id', 'LIB-GHOST');
    const onSetBookListError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const { result } = renderHook(
      () => ({
        fetchBookList: useFetchBookList(),
        target: useLibraryTarget(),
        withTargetUser: useWithTargetUser(),
      }),
      {
        wrapper: makeAdminWrapper({ onSetBookListError }, [
          matchingUserListMock('ghost', 'LIB-GHOST'),
        ]),
      }
    );

    await waitFor(() => expect(result.current.withTargetUser.username).toBe('ghost'));

    await act(() => result.current.fetchBookList());

    // `seedAdmin()` seeds a real JWT, so `apiFetch` attaches a real
    // `Authorization` header here (unlike this file's other, non-admin
    // tests) — asserting only the URL argument, not the full call, is
    // what actually matters: that `?user=ghost` really went out.
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/books?take=20&user=ghost');
    expect(result.current.target[0]).toBeUndefined();
    expect(localStorage.getItem('library-target-id')).toBeNull();
    expect(onSetBookListError).not.toHaveBeenCalledWith('Failed to fetch books');
  });

  it('still surfaces an error for a non-404 failure when a target is selected', async () => {
    seedAdmin();
    localStorage.setItem('library-target-id', 'LIB-ALICE');
    const onSetBookListError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { result } = renderHook(
      () => ({
        fetchBookList: useFetchBookList(),
        target: useLibraryTarget(),
        withTargetUser: useWithTargetUser(),
      }),
      {
        wrapper: makeAdminWrapper({ onSetBookListError }, [
          matchingUserListMock('alice', 'LIB-ALICE'),
        ]),
      }
    );

    await waitFor(() => expect(result.current.withTargetUser.username).toBe('alice'));

    await act(() => result.current.fetchBookList());

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/books?take=20&user=alice');
    expect(result.current.target[0]).toBe('LIB-ALICE');
    expect(onSetBookListError).toHaveBeenCalledWith('Failed to fetch books');
  });
});

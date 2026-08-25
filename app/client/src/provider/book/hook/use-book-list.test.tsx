import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { use, useCallback, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserListDocument } from '~/graphql/user';
import { LibraryTargetProvider, useLibraryTarget } from '~/provider/library-target';
import { ApolloTestProvider, renderWithApollo } from '~/test-utils';

import { Context } from '../context';
import { BookProvider } from '../provider';
import type { Book, BookList } from '../type';
import { useBookList, type UseBookList } from './use-book-list';

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
      <ApolloTestProvider>
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
            setBookListItems: () => {},
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

  // Was: 're-fetches with new filter params when bookListFilter changes',
  // driven through `useBookListFilter()`'s setter. `useBookListFilter` no
  // longer writes into `BookContext` (step 10 / task 3: it's pure URL state
  // now — the context copy was a write-only cache, with the dedup effect
  // that wrote it as its only reader). Nothing in production calls
  // `BookContext`'s `setBookListFilter` any more, so that coupling can't
  // happen through `useBookListFilter` today. `useBookList` itself is
  // unchanged and still reacts to the context value if something sets it
  // directly, which this exercises via `use(Context)` instead.
  it('re-fetches with new filter params when the context filter is set directly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [], books: [], nextCursor: null }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApolloTestProvider>
        <MemoryRouter>
          <LibraryTargetProvider>
            <BookProvider>{children}</BookProvider>
          </LibraryTargetProvider>
        </MemoryRouter>
      </ApolloTestProvider>
    );

    const { result } = renderHook(() => ({ list: useBookList(), context: use(Context) }), {
      wrapper,
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenLastCalledWith('/api/books?take=20', {});

    await act(async () => {
      result.current.context.setBookListFilter({ query: 'test' });
    });

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('/api/books?query=test&take=20', {})
    );
    expect(mockFetch).toHaveBeenLastCalledWith('/api/books?query=test&take=20', {});
  });

  // C-1 (task-4 fix-round-1 review): a cold admin page load restores
  // `targetLibraryId` synchronously from `localStorage`, but resolving it to
  // a USERNAME (`useWithTargetUser`) is a `UserListDocument` network round
  // trip that cannot have answered on the very first render. Firing anyway
  // built a `?user=`-less URL, which the server 400s and this hook latches
  // as a permanent `bookListError` — the retry-on-target-change effect never
  // fires again because it's gated on `bookListError === undefined`. This
  // reproduces the REAL composition (`BookProvider` + `LibraryTargetProvider`
  // + a real, not-yet-resolved Apollo mock), not just the guarded callback in
  // isolation.
  it('does not fire a ?user=-less request on a cold admin load, and retries once the target user resolves', async () => {
    localStorage.setItem('library-target-id', 'LIB-ALICE');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [], books: [], nextCursor: null }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const userListMock = {
      request: { query: UserListDocument },
      result: {
        data: {
          __typename: 'Query' as const,
          viewer: {
            __typename: 'Viewer' as const,
            users: [
              {
                __typename: 'User' as const,
                id: 'u1',
                username: 'alice',
                progressCount: 0,
                library: { __typename: 'Library' as const, id: 'LIB-ALICE' },
              },
            ],
          },
        },
      },
    };

    const result: { current?: UseBookList } = {};
    const Probe = () => {
      result.current = useBookList();
      return null;
    };

    renderWithApollo(
      <LibraryTargetProvider>
        <BookProvider>
          <Probe />
        </BookProvider>
      </LibraryTargetProvider>,
      { mocks: [userListMock], user: { username: 'admin', isAdmin: true } }
    );

    // Cold load: the Library id is already restored, but UserListDocument
    // has not answered yet — the guard must defer, not send a ?user=-less
    // request the server would 400.
    expect(mockFetch).not.toHaveBeenCalled();

    // Once the username resolves, the deferred fetch retries with ?user=.
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('/api/books?take=20&user=alice', {})
    );
    await waitFor(() => expect(result.current?.[2]).toBe(false));
  });

  // Round-2 review: C-1's fix narrowed the cold-load window but left an
  // ADJACENT one open — a stored `library-target-id` that matches NO user
  // (deleted owner, or an id stale across installs). `ready` still flips
  // true once `UserListDocument` settles, but `withTargetUser.username`
  // stays undefined, so a `?user=`-less request would fire and the server
  // 400s it — `!response.ok` throws, `bookListError` latches, and (unlike a
  // real 404) there is no status-code branch that ever clears it: this is a
  // STICKY error with no route back except manually re-picking in the
  // switcher. This is a regression against pre-Task-4 behavior, where a
  // dead username 404'd and self-healed automatically.
  it('clears a target that resolves to no match, instead of latching a permanent error', async () => {
    localStorage.setItem('library-target-id', 'LIB-GHOST');
    // The server's real answer for a ?user=-less admin request — reachable
    // only if the fix below fails to clear the selection first.
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal('fetch', mockFetch);

    const emptyUserListMock = {
      request: { query: UserListDocument },
      result: {
        data: {
          __typename: 'Query' as const,
          viewer: { __typename: 'Viewer' as const, users: [] },
        },
      },
    };

    const result: { current?: UseBookList } = {};
    const Probe = () => {
      result.current = useBookList();
      return null;
    };

    renderWithApollo(
      <LibraryTargetProvider>
        <BookProvider>
          <Probe />
        </BookProvider>
      </LibraryTargetProvider>,
      { mocks: [emptyUserListMock], user: { username: 'admin', isAdmin: true } }
    );

    // The selection clears once UserListDocument settles with no match —
    // no fetch is ever attempted, so no error can latch.
    await waitFor(() => expect(localStorage.getItem('library-target-id')).toBeNull());
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current?.[2]).toBe(false);
    expect(result.current?.[3]).toBeUndefined();
  });
});

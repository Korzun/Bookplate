import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApolloTestProvider } from '~/test-utils';

import { Context as ProgressContext } from '../../progress/context';
import type { ProgressList, UserProgressList } from '../../progress/type';
import { Context } from '../context';
import type { Book, BookList } from '../type';
import { usePatchBookMetadata } from './use-patch-book-metadata';

// `globalId` (2026-08-13 final review, C-2 — human ruling, Option 1): every
// real `PATCH .../metadata` response now carries it alongside the pre-
// existing raw `id`. Defaulted here (not required on every `makeBook` call
// site) so the many tests below that don't care about it stay unchanged;
// the one test that DOES (`'returns the new book id and its global id on
// success'`) passes an explicit `globalId` override instead of relying on
// this default, so its expectation is visible at the call site.
function makeBook(
  overrides: Partial<Book> & { id: string; globalId?: string }
): Book & { globalId: string } {
  return {
    title: 'Dune',
    author: 'Herbert',
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
    globalId: overrides.globalId ?? `global-${overrides.id}`,
  };
}

type WrapperOptions = {
  initialBooks?: Book[];
  initialProgress?: ProgressList;
  setBookListFetched?: (fetched: boolean) => void;
  setBookListItems?: (
    updater: (prev: import('../type').DisplayUnit[]) => import('../type').DisplayUnit[]
  ) => void;
};

function makeWrapper({
  initialBooks = [],
  initialProgress = {},
  setBookListFetched = () => {},
  setBookListItems = () => {},
}: WrapperOptions = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>(
      Object.fromEntries(initialBooks.map((b) => [b.id, b]))
    );
    const setBookList = useCallback(
      (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
      []
    );
    const [progressList, setProgressListRaw] = useState<ProgressList>(initialProgress);
    const setProgressForUsername = useCallback((username: string, data: UserProgressList) => {
      setProgressListRaw((prev) => ({ ...prev, [username]: data }));
    }, []);
    const renameProgressKey = useCallback((oldId: string, newId: string) => {
      setProgressListRaw((prev) => {
        const next = { ...prev };
        for (const username of Object.keys(next)) {
          const userProgress = next[username];
          if (userProgress && oldId in userProgress) {
            const { [oldId]: oldEntry, ...rest } = userProgress;
            next[username] = { ...rest, [newId]: { ...oldEntry, document: newId } };
          }
        }
        return next;
      });
    }, []);
    return (
      <ApolloTestProvider>
        <ProgressContext.Provider
          value={{
            progressList,
            loadingByUsername: {},
            errorByUsername: {},
            setProgressForUsername,
            setLoadingForUsername: () => {},
            setErrorForUsername: () => {},
            renameProgressKey,
          }}
        >
          <Context.Provider
            value={{
              bookList,
              bookListFetched: true,
              bookListLoading: false,
              bookListError: undefined,
              loadingByBookId: {},
              errorByBookId: {},
              completeBookIds: new Set(),
              setBookList,
              setBookListFetched,
              setBookListLoading: () => {},
              setBookListError: () => {},
              setLoadingForBook: () => {},
              setErrorForBook: () => {},
              setBookComplete: () => {},
              clearCompleteBookIds: () => {},
              bookListItems: [],
              setBookListItems,
              bookListFilter: {},
              setBookListFilter: () => {},
            }}
          >
            {children}
          </Context.Provider>
        </ProgressContext.Provider>
      </ApolloTestProvider>
    );
  };
}

/**
 * Same Context shape as `makeWrapper`, but takes the initial `BookList` map
 * directly — needed for the alias-key test below, which files the book
 * under a key OTHER than its own `.id` (simulating a book reached via a
 * Relay global id, whose cache entry `useFetchBook` keys by the REQUESTED
 * id rather than `book.id` — see `use-regen-chapters.ts`'s doc comment for
 * the full mechanism, task 8 review round 1/2).
 */
function makeWrapperWithBookList(bookList: BookList) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [state, setBookListRaw] = useState<BookList>(bookList);
    const setBookList = useCallback(
      (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
      []
    );
    return (
      <ApolloTestProvider>
        <ProgressContext.Provider
          value={{
            progressList: {},
            loadingByUsername: {},
            errorByUsername: {},
            setProgressForUsername: () => {},
            setLoadingForUsername: () => {},
            setErrorForUsername: () => {},
            renameProgressKey: () => {},
          }}
        >
          <Context.Provider
            value={{
              bookList: state,
              bookListFetched: true,
              bookListLoading: false,
              bookListError: undefined,
              loadingByBookId: {},
              errorByBookId: {},
              completeBookIds: new Set(['global-1']),
              setBookList,
              setBookListFetched: () => {},
              setBookListLoading: () => {},
              setBookListError: () => {},
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
        </ProgressContext.Provider>
      </ApolloTestProvider>
    );
  };
}

describe('usePatchBookMetadata', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls PATCH /api/books/:id/metadata', async () => {
    const updated = makeBook({ id: '1', title: 'New Dune' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
    );
    const { result } = renderHook(() => usePatchBookMetadata(), {
      wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
    });
    await act(() => result.current[0]('1', { title: 'New Dune' }));
    expect(fetch).toHaveBeenCalledWith(
      `/api/books/${encodeURIComponent('1')}/metadata`,
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('sends scalar fields as plain FormData strings', async () => {
    const updated = makeBook({ id: '1', title: 'New Title' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
    );
    const { result } = renderHook(() => usePatchBookMetadata(), {
      wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
    });
    await act(() => result.current[0]('1', { title: 'New Title', author: 'New Author' }));
    const body = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.get('title')).toBe('New Title');
    expect(body.get('author')).toBe('New Author');
  });

  it('serialises subjects and identifiers as JSON strings', async () => {
    const updated = makeBook({ id: '1' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
    );
    const { result } = renderHook(() => usePatchBookMetadata(), {
      wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
    });
    await act(() =>
      result.current[0]('1', {
        subjects: ['fiction', 'sci-fi'],
        identifiers: [{ scheme: 'isbn', value: '123' }],
      })
    );
    const body = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as FormData;
    expect(JSON.parse(body.get('subjects') as string)).toEqual(['fiction', 'sci-fi']);
    expect(JSON.parse(body.get('identifiers') as string)).toEqual([
      { scheme: 'isbn', value: '123' },
    ]);
  });

  it('updates context with the returned book on success', async () => {
    const updated = makeBook({ id: '1', title: 'Updated' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
    );
    const { result } = renderHook(
      () => ({ hook: usePatchBookMetadata(), ctx: useContext(Context) }),
      { wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }) }
    );
    await act(() => result.current.hook[0]('1', { title: 'Updated' }));
    expect(result.current.ctx.bookList['1'].title).toBe('Updated');
  });

  it('removes old key when returned book has a different id', async () => {
    const updated = makeBook({ id: '2', title: 'Renamed' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
    );
    const { result } = renderHook(
      () => ({ hook: usePatchBookMetadata(), ctx: useContext(Context) }),
      { wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }) }
    );
    await act(() => result.current.hook[0]('1', { title: 'Renamed' }));
    expect(result.current.ctx.bookList['1']).toBeUndefined();
    expect(result.current.ctx.bookList['2']).toBeDefined();
  });

  // Task 8 review round 2: `bookId` here is always the resolved raw id
  // (`page/book-edit` passes the id its own `useBook` resolved), but a book
  // reached earlier via a Relay global id (the grid) can have its `bookList`
  // entry filed under THAT global-id key instead — `useFetchBook` keys by
  // the REQUESTED id, not `book.id`. The pre-fix `next[bookId]`-only
  // deletion never touched that alias: the stale, pre-edit copy survived
  // under `global-1` forever, and `completeBookIds` still marked it
  // complete, so `useBook` never refetched it — browsing back to the
  // book's original (global-id) URL would silently show the pre-edit book.
  it('clears a stale alias entry (cached under a different key than its own id) after a metadata edit', async () => {
    const updated = makeBook({ id: 'raw-1', title: 'Updated' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
    );
    const preEdit = makeBook({ id: 'raw-1', title: 'Dune' });
    const { result } = renderHook(
      () => ({ hook: usePatchBookMetadata(), ctx: useContext(Context) }),
      // Filed under 'global-1' — a different key than the book's own raw id
      // ('raw-1') — exactly what a grid-originated (global-id) navigation
      // produces via `useFetchBook`.
      { wrapper: makeWrapperWithBookList({ 'global-1': preEdit }) }
    );

    await act(() => result.current.hook[0]('raw-1', { title: 'Updated' }));

    expect(result.current.ctx.bookList['global-1']).toBeUndefined();
    expect(result.current.ctx.bookList['raw-1']).toBeDefined();
    expect(result.current.ctx.bookList['raw-1'].title).toBe('Updated');
  });

  it('returns the new book id and its global id on success', async () => {
    const updated = makeBook({ id: '2', globalId: 'gid-2' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
    );
    const { result } = renderHook(() => usePatchBookMetadata(), {
      wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
    });
    const patched = await act(() => result.current[0]('1', {}));
    expect(patched).toEqual({ id: '2', globalId: 'gid-2' });
  });

  it('sets error with body.error message on failed response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Validation failed' }),
      })
    );
    const { result } = renderHook(() => usePatchBookMetadata(), {
      wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
    });
    await act(() => result.current[0]('1', {}));
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Validation failed');
  });

  it('falls back to "Save failed" when error response has no body.error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      })
    );
    const { result } = renderHook(() => usePatchBookMetadata(), {
      wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
    });
    await act(() => result.current[0]('1', {}));
    expect(result.current[3]).toBe('Save failed');
  });

  it('does not send a second request while the first is still in flight', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    const { result } = renderHook(() => usePatchBookMetadata(), {
      wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
    });

    act(() => {
      void result.current[0]('1', { title: 'First' });
    });
    await waitFor(() => expect(result.current[1]).toBe(true));

    await act(() => result.current[0]('1', { title: 'Second' }));

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('moves progress from old to new id in all users caches when book id changes', async () => {
    const initialProgress: ProgressList = {
      alice: { 'old-id': { document: 'old-id', percentage: 0.5 } },
      bob: {
        'old-id': { document: 'old-id', percentage: 0.3 },
        'other-book': { document: 'other-book', percentage: 0.8 },
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeBook({ id: 'new-id', title: 'Updated' })),
      })
    );
    const { result } = renderHook(
      () => ({ hook: usePatchBookMetadata(), ctx: useContext(ProgressContext) }),
      { wrapper: makeWrapper({ initialBooks: [makeBook({ id: 'old-id' })], initialProgress }) }
    );
    await act(() => result.current.hook[0]('old-id', { title: 'Updated' }));
    expect(result.current.ctx.progressList['alice']['new-id']).toBeDefined();
    expect(result.current.ctx.progressList['alice']['old-id']).toBeUndefined();
    expect(result.current.ctx.progressList['bob']['new-id']).toBeDefined();
    expect(result.current.ctx.progressList['bob']['old-id']).toBeUndefined();
    expect(result.current.ctx.progressList['bob']['other-book']).toBeDefined();
  });

  it('does not touch progress cache when book id is unchanged', async () => {
    const initialProgress: ProgressList = {
      alice: { 'book-1': { document: 'book-1', percentage: 0.5 } },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeBook({ id: 'book-1', title: 'Updated' })),
      })
    );
    const { result } = renderHook(
      () => ({ hook: usePatchBookMetadata(), ctx: useContext(ProgressContext) }),
      { wrapper: makeWrapper({ initialBooks: [makeBook({ id: 'book-1' })], initialProgress }) }
    );
    await act(() => result.current.hook[0]('book-1', { title: 'Updated' }));
    expect(result.current.ctx.progressList['alice']['book-1']).toBeDefined();
  });

  it('invalidates the book list after a successful patch so stale items are re-fetched', async () => {
    const setBookListFetched = vi.fn();
    const setBookListItems = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeBook({ id: 'new-id', series: 'New Series' })),
      })
    );
    const { result } = renderHook(() => usePatchBookMetadata(), {
      wrapper: makeWrapper({
        initialBooks: [makeBook({ id: 'old-id' })],
        setBookListFetched,
        setBookListItems,
      }),
    });
    await act(() => result.current[0]('old-id', { series: 'New Series' }));
    expect(setBookListFetched).toHaveBeenCalledWith(false);
    expect(setBookListItems).toHaveBeenCalled();
  });
});

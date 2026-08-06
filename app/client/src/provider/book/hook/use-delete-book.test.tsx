import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApolloTestProvider } from '~/test-utils';

import { Context } from '../context';
import type { Book, BookList, DisplayUnit } from '../type';
import { useDeleteBook } from './use-delete-book';

function makeBook(overrides: Partial<Book> & { id: string }): Book {
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
  };
}

function makeWrapper(
  initialBooks: Book[] = [],
  clearCompleteBookIds = vi.fn(),
  initialItems: DisplayUnit[] = [],
  /** Overrides the derived `{ [book.id]: book }` map — for alias-key fixtures where a book sits under a key other than its own `id`. */
  initialBookList?: BookList
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>(
      initialBookList ?? Object.fromEntries(initialBooks.map((b) => [b.id, b]))
    );
    const setBookList = useCallback(
      (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
      []
    );
    const [bookListItems, setBookListItemsRaw] = useState<DisplayUnit[]>(initialItems);
    const setBookListItems = useCallback(
      (updater: (prev: DisplayUnit[]) => DisplayUnit[]) => setBookListItemsRaw(updater),
      []
    );
    return (
      <ApolloTestProvider>
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
            setBookListFetched: () => {},
            setBookListLoading: () => {},
            setBookListError: () => {},
            setLoadingForBook: () => {},
            setErrorForBook: () => {},
            setBookComplete: () => {},
            clearCompleteBookIds,
            bookListItems,
            setBookListItems,
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

describe('useDeleteBook', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('optimistically removes the book from context before fetch resolves', async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((r) => {
          resolve = r;
        })
      )
    );
    const book = makeBook({ id: '1' });
    const { result } = renderHook(() => ({ hook: useDeleteBook(), ctx: useContext(Context) }), {
      wrapper: makeWrapper([book]),
    });
    act(() => {
      void result.current.hook[0]('1');
    });
    expect(result.current.ctx.bookList['1']).toBeUndefined();
    resolve({ status: 204 });
    await waitFor(() => expect(result.current.hook[1]).toBe(false));
  });

  it('calls DELETE /api/books/:id (URL-encoded)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const { result } = renderHook(() => useDeleteBook(), {
      wrapper: makeWrapper([makeBook({ id: 'book/1' })]),
    });
    await act(() => result.current[0]('book/1'));
    expect(fetch).toHaveBeenCalledWith(`/api/books/${encodeURIComponent('book/1')}`, {
      method: 'DELETE',
    });
  });

  it('book stays removed on 204 success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const book = makeBook({ id: '1' });
    const { result } = renderHook(() => ({ hook: useDeleteBook(), ctx: useContext(Context) }), {
      wrapper: makeWrapper([book]),
    });
    await act(() => result.current.hook[0]('1'));
    expect(result.current.ctx.bookList['1']).toBeUndefined();
    expect(result.current.hook[2]).toBe(false);
  });

  it('rolls back and sets error on non-204 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500 }));
    const book = makeBook({ id: '1' });
    const { result } = renderHook(() => ({ hook: useDeleteBook(), ctx: useContext(Context) }), {
      wrapper: makeWrapper([book]),
    });
    await act(() => result.current.hook[0]('1'));
    expect(result.current.ctx.bookList['1']).toEqual(book);
    expect(result.current.hook[2]).toBe(true);
  });

  it('rolls back, sets error and errorMessage when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const book = makeBook({ id: '1' });
    const { result } = renderHook(() => ({ hook: useDeleteBook(), ctx: useContext(Context) }), {
      wrapper: makeWrapper([book]),
    });
    await act(() => result.current.hook[0]('1'));
    expect(result.current.ctx.bookList['1']).toEqual(book);
    expect(result.current.hook[2]).toBe(true);
    expect(result.current.hook[3]).toBe('Network error');
  });

  it('sets loading true during request and resets it after', async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((r) => {
          resolve = r;
        })
      )
    );
    const { result } = renderHook(() => useDeleteBook(), {
      wrapper: makeWrapper([makeBook({ id: '1' })]),
    });
    act(() => {
      void result.current[0]('1');
    });
    expect(result.current[1]).toBe(true);
    resolve({ status: 204 });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  it('sets error immediately when the bookId is not in the list', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useDeleteBook(), { wrapper: makeWrapper() });
    await act(() => result.current[0]('nonexistent'));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Failed to delete book');
  });

  it('does not send a second request while the first is still in flight', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    const { result } = renderHook(() => useDeleteBook(), {
      wrapper: makeWrapper([makeBook({ id: '1' }), makeBook({ id: '2' })]),
    });

    // First call — starts loading
    act(() => {
      void result.current[0]('1');
    });
    await waitFor(() => expect(result.current[1]).toBe(true));

    // Second call while loading — should be ignored
    await act(() => result.current[0]('2'));

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('removes the deleted book from bookListItems on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const items: DisplayUnit[] = [
      { type: 'standalone', bookId: '1' },
      { type: 'standalone', bookId: '2' },
    ];
    const { result } = renderHook(() => ({ hook: useDeleteBook(), ctx: useContext(Context) }), {
      wrapper: makeWrapper([makeBook({ id: '1' }), makeBook({ id: '2' })], vi.fn(), items),
    });
    await act(() => result.current.hook[0]('1'));
    expect(result.current.ctx.bookListItems).toEqual([{ type: 'standalone', bookId: '2' }]);
  });

  it('removes the series item from bookListItems when deleting the last book in a series', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const items: DisplayUnit[] = [
      { type: 'standalone', bookId: '1' },
      { type: 'series', seriesName: 'Teixcalaan' },
    ];
    const { result } = renderHook(() => ({ hook: useDeleteBook(), ctx: useContext(Context) }), {
      wrapper: makeWrapper(
        [makeBook({ id: '1' }), makeBook({ id: '2', series: 'Teixcalaan', seriesIndex: 1 })],
        vi.fn(),
        items
      ),
    });
    await act(() => result.current.hook[0]('2'));
    expect(result.current.ctx.bookListItems).toEqual([{ type: 'standalone', bookId: '1' }]);
  });

  it('keeps the series item in bookListItems when other books remain in the series', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const items: DisplayUnit[] = [{ type: 'series', seriesName: 'Teixcalaan' }];
    const { result } = renderHook(() => ({ hook: useDeleteBook(), ctx: useContext(Context) }), {
      wrapper: makeWrapper(
        [
          makeBook({ id: '1', series: 'Teixcalaan', seriesIndex: 1 }),
          makeBook({ id: '2', series: 'Teixcalaan', seriesIndex: 2 }),
        ],
        vi.fn(),
        items
      ),
    });
    await act(() => result.current.hook[0]('2'));
    expect(result.current.ctx.bookListItems).toEqual(items);
  });

  it('restores the series item at its original position on rollback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500 }));
    const items: DisplayUnit[] = [
      { type: 'standalone', bookId: '1' },
      { type: 'series', seriesName: 'Teixcalaan' },
      { type: 'standalone', bookId: '3' },
    ];
    const { result } = renderHook(() => ({ hook: useDeleteBook(), ctx: useContext(Context) }), {
      wrapper: makeWrapper(
        [
          makeBook({ id: '1' }),
          makeBook({ id: '2', series: 'Teixcalaan', seriesIndex: 1 }),
          makeBook({ id: '3' }),
        ],
        vi.fn(),
        items
      ),
    });
    await act(() => result.current.hook[0]('2'));
    expect(result.current.ctx.bookListItems).toEqual(items);
    expect(result.current.hook[2]).toBe(true);
  });

  it('restores the item in bookListItems at its original position on rollback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500 }));
    const items: DisplayUnit[] = [
      { type: 'standalone', bookId: '1' },
      { type: 'standalone', bookId: '2' },
      { type: 'standalone', bookId: '3' },
    ];
    const { result } = renderHook(() => ({ hook: useDeleteBook(), ctx: useContext(Context) }), {
      wrapper: makeWrapper(
        [makeBook({ id: '1' }), makeBook({ id: '2' }), makeBook({ id: '3' })],
        vi.fn(),
        items
      ),
    });
    await act(() => result.current.hook[0]('2'));
    expect(result.current.ctx.bookListItems).toEqual(items);
    expect(result.current.hook[2]).toBe(true);
  });

  // Final-branch-review I-2: a book reached both via its Relay global id
  // (the grid) and its raw id (the search dropdown) sits under TWO
  // `bookList` keys describing the SAME book. Deleting only the requested
  // key left the other alias's stale copy in place forever — this is the
  // seen-to-fail for that.
  describe('alias sweep (final-branch-review I-2)', () => {
    it('removes every bookList entry describing the deleted book, not just the requested key', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
      const book = makeBook({ id: 'raw-1' });
      const { result } = renderHook(() => ({ hook: useDeleteBook(), ctx: useContext(Context) }), {
        wrapper: makeWrapper([book], vi.fn(), [], { 'global-1': book, 'raw-1': book }),
      });

      await act(() => result.current.hook[0]('raw-1'));

      expect(result.current.ctx.bookList['raw-1']).toBeUndefined();
      expect(result.current.ctx.bookList['global-1']).toBeUndefined();
    });

    it('restores under the requested key on rollback, not the book’s own raw id', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500 }));
      const book = makeBook({ id: 'raw-1' });
      const { result } = renderHook(() => ({ hook: useDeleteBook(), ctx: useContext(Context) }), {
        wrapper: makeWrapper([book], vi.fn(), [], { 'global-1': book }),
      });

      await act(() => result.current.hook[0]('global-1'));

      expect(result.current.ctx.bookList['global-1']).toEqual(book);
      // No stray duplicate written under the book's own raw id — that key
      // was never in the list to begin with, and the failed delete must not
      // invent one.
      expect(result.current.ctx.bookList['raw-1']).toBeUndefined();
    });

    // Re-review Important: `isLastInSeries` (line 64) still compared
    // `other.id !== id` — the REQUESTED key, not the book's own raw id.
    // When `id` is a global-id alias, every OTHER entry's `.id` is raw and
    // therefore always `!== id`, so the book's own alias entries counted as
    // "another book in the series", and a genuinely-last book's series row
    // was never optimistically removed.
    it('treats the book being deleted as the only series member, even requested by an alias key', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
      const book = makeBook({ id: 'raw-1', series: 'Teixcalaan', seriesIndex: 1 });
      const items: DisplayUnit[] = [{ type: 'series', seriesName: 'Teixcalaan' }];
      const { result } = renderHook(() => ({ hook: useDeleteBook(), ctx: useContext(Context) }), {
        wrapper: makeWrapper([], vi.fn(), items, { 'global-1': book, 'raw-1': book }),
      });

      await act(() => result.current.hook[0]('global-1'));

      expect(result.current.ctx.bookListItems).toEqual([]);
    });
  });
});

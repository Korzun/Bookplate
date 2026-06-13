import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList } from '../type';

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

function makeWrapper(initialBooks: Book[] = [], clearCompleteBookIds = vi.fn()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>(
      Object.fromEntries(initialBooks.map((b) => [b.id, b]))
    );
    const setBookList = useCallback(
      (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
      []
    );
    return (
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
});

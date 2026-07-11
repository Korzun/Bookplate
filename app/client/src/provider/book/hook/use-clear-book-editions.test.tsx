import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList } from '../type';

import { useClearBookEditions } from './use-clear-book-editions';

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
    deviceEditionCount: 3,
    ...overrides,
  };
}

function makeWrapper(initialBooks: Book[] = []) {
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
          clearCompleteBookIds: () => {},
          bookListItems: [],
          nextCursor: null,
          setBookListItems: () => {},
          setNextCursor: () => {},
          bookListFilter: {},
          setBookListFilter: () => {},
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

describe('useClearBookEditions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls DELETE /api/books/:id/editions (URL-encoded)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ cleared: 3 }) })
    );
    const { result } = renderHook(() => useClearBookEditions(), {
      wrapper: makeWrapper([makeBook({ id: 'book/1' })]),
    });
    await act(() => result.current[0]('book/1'));
    expect(fetch).toHaveBeenCalledWith(`/api/books/${encodeURIComponent('book/1')}/editions`, {
      method: 'DELETE',
    });
  });

  it('resets the book count to 0 and returns the cleared count on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ cleared: 3 }) })
    );
    let returned: number | undefined;
    const { result } = renderHook(
      () => ({ hook: useClearBookEditions(), ctx: useContext(Context) }),
      {
        wrapper: makeWrapper([makeBook({ id: '1' })]),
      }
    );
    await act(async () => {
      returned = await result.current.hook[0]('1');
    });
    expect(returned).toBe(3);
    expect(result.current.ctx.bookList['1'].deviceEditionCount).toBe(0);
    expect(result.current.hook[2]).toBe(false);
  });

  it('sets error and returns undefined on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    let returned: number | undefined = 999;
    const { result } = renderHook(() => useClearBookEditions(), {
      wrapper: makeWrapper([makeBook({ id: '1' })]),
    });
    await act(async () => {
      returned = await result.current[0]('1');
    });
    expect(returned).toBeUndefined();
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Failed to clear device editions');
  });

  it('does not send a second request while the first is still in flight', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() => useClearBookEditions(), {
      wrapper: makeWrapper([makeBook({ id: '1' })]),
    });
    act(() => {
      void result.current[0]('1');
    });
    await waitFor(() => expect(result.current[1]).toBe(true));
    await act(() => result.current[0]('1'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApolloTestProvider } from '~/test-utils';

import { Context } from '../context';
import type { Book, BookList } from '../type';

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

function makeWrapper(mockSetBookComplete: () => void, bookListRef?: { current: BookList }) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>({});
    const [loadingByBookId, setLoadingByBookIdRaw] = useState<Record<string, boolean>>({});
    const [errorByBookId, setErrorByBookIdRaw] = useState<Record<string, string | undefined>>({});

    useEffect(() => {
      if (bookListRef) bookListRef.current = bookList;
    }, [bookList]);

    const setBookList = useCallback(
      (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
      []
    );
    const setLoadingForBook = useCallback((bookId: string, loading: boolean) => {
      setLoadingByBookIdRaw((prev) => ({ ...prev, [bookId]: loading }));
    }, []);
    const setErrorForBook = useCallback((bookId: string, error: string | undefined) => {
      setErrorByBookIdRaw((prev) => ({ ...prev, [bookId]: error }));
    }, []);

    return (
      <ApolloTestProvider>
        <Context.Provider
          value={{
            bookList,
            bookListFetched: false,
            bookListLoading: false,
            bookListError: undefined,
            loadingByBookId,
            errorByBookId,
            completeBookIds: new Set(),
            setBookList,
            setBookListFetched: () => {},
            setBookListLoading: () => {},
            setBookListError: () => {},
            setLoadingForBook,
            setErrorForBook,
            setBookComplete: mockSetBookComplete,
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

import { useFetchBook } from './use-fetch-book';

describe('useFetchBook', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls setBookComplete with bookId on successful fetch', async () => {
    const mockSetBookComplete = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeBook({ id: '1' })),
      })
    );

    const { result } = renderHook(() => useFetchBook(), {
      wrapper: makeWrapper(mockSetBookComplete),
    });

    await act(() => result.current('1'));

    expect(mockSetBookComplete).toHaveBeenCalledWith('1');
  });

  it('does not call setBookComplete when fetch returns non-ok response', async () => {
    const mockSetBookComplete = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useFetchBook(), {
      wrapper: makeWrapper(mockSetBookComplete),
    });

    await act(() => result.current('1'));

    expect(mockSetBookComplete).not.toHaveBeenCalled();
  });

  it('does not call setBookComplete when fetch throws', async () => {
    const mockSetBookComplete = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const { result } = renderHook(() => useFetchBook(), {
      wrapper: makeWrapper(mockSetBookComplete),
    });

    await act(() => result.current('1'));

    expect(mockSetBookComplete).not.toHaveBeenCalled();
  });

  // The legacy `/api/books/:id` route now also accepts a Relay global ID
  // (task 13) and resolves it server-side to the book's raw, content-hash
  // local id — so the response body's own `id` field can legitimately
  // differ from the id this hook was asked to fetch. `useBook`
  // (`use-book.ts`) looks up `bookList[bookId]` keyed by the REQUESTED id,
  // matching every other per-book map on this context
  // (`loadingByBookId`/`errorByBookId`/`completeBookIds`, all keyed by the
  // hook's own `bookId` argument) — so this hook must store under that same
  // key too. Storing under `book.id` instead (the pre-fix behavior) leaves
  // `bookList[bookId]` permanently `undefined` for a global-id request:
  // `useBook`'s own effect re-fires every render (its `bookList[bookId] ===
  // undefined` guard never clears), refetching in an infinite loop, and the
  // book page never leaves its loading state — verified as this test's
  // seen-to-fail (task 8 report).
  it('stores the fetched book under the REQUESTED id, even when the server resolves it to a different raw id', async () => {
    const mockSetBookComplete = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeBook({ id: 'raw-1' })),
      })
    );

    const bookListRef: { current: BookList } = { current: {} };
    const { result } = renderHook(() => useFetchBook(), {
      wrapper: makeWrapper(mockSetBookComplete, bookListRef),
    });

    // 'global-1' stands in for a Relay global ID reaching this hook from a
    // grid-originated navigation (`BookRowFromEntry`'s `path.book(unmasked.id)`);
    // the server resolves it to the raw id 'raw-1' in the response body.
    await act(() => result.current('global-1'));

    expect(bookListRef.current['global-1']).toBeDefined();
    expect(bookListRef.current['global-1']?.id).toBe('raw-1');
  });
});

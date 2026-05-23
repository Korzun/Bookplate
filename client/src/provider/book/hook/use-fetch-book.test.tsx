import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList } from '../type';

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Title',
    author: 'Author',
    fileAs: '',
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

function makeWrapper(mockSetBookComplete: () => void) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>({});
    const [loadingByBookId, setLoadingByBookIdRaw] = useState<Record<string, boolean>>({});
    const [errorByBookId, setErrorByBookIdRaw] = useState<Record<string, string | undefined>>({});

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
        }}
      >
        {children}
      </Context.Provider>
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
});

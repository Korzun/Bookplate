import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList } from '../type';

import { useFetchBookList } from './use-fetch-book-list';

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

function makeWrapper({
  initialBooks = {} as BookList,
  bookListLoading = false,
  completeBookIds = new Set<string>(),

  onSetBookList = (_: BookList) => {},
  onSetBookListFetched = vi.fn(),
  onSetBookListError = vi.fn(),
} = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>(initialBooks);
    const [loading, setLoading] = useState(bookListLoading);
    const setBookList = useCallback((updater: (prev: BookList) => BookList) => {
      setBookListRaw((prev) => {
        const next = updater(prev);
        onSetBookList(next);
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
          setBookList,
          setBookListFetched: onSetBookListFetched,
          setBookListLoading: (v) => setLoading(v),
          setBookListError: onSetBookListError,
          setLoadingForBook: () => {},
          setErrorForBook: () => {},
          setBookComplete: () => {},
          clearCompleteBookIds: () => {},
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

describe('useFetchBookList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches GET /api/books', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    );
    const { result } = renderHook(() => useFetchBookList(), { wrapper: makeWrapper() });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith('/api/books', {});
  });

  it('sets bookListFetched to true on success', async () => {
    const onSetBookListFetched = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ onSetBookListFetched }),
    });
    await act(() => result.current());
    expect(onSetBookListFetched).toHaveBeenCalledWith(true);
  });

  it('populates context with fetched books', async () => {
    const books = [makeBook({ id: '1', title: 'Dune' })];
    const onSetBookList = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(books) })
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
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([serverBook]) })
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
});

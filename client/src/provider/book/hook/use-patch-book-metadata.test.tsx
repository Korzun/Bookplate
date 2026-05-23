import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList } from '../type';

import { usePatchBookMetadata } from './use-patch-book-metadata';

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Dune',
    author: 'Herbert',
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
        }}
      >
        {children}
      </Context.Provider>
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
      wrapper: makeWrapper([makeBook({ id: '1' })]),
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
      wrapper: makeWrapper([makeBook({ id: '1' })]),
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
      wrapper: makeWrapper([makeBook({ id: '1' })]),
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
      { wrapper: makeWrapper([makeBook({ id: '1' })]) }
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
      { wrapper: makeWrapper([makeBook({ id: '1' })]) }
    );
    await act(() => result.current.hook[0]('1', { title: 'Renamed' }));
    expect(result.current.ctx.bookList['1']).toBeUndefined();
    expect(result.current.ctx.bookList['2']).toBeDefined();
  });

  it('returns the new book id on success', async () => {
    const updated = makeBook({ id: '2' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
    );
    const { result } = renderHook(() => usePatchBookMetadata(), {
      wrapper: makeWrapper([makeBook({ id: '1' })]),
    });
    const id = await act(() => result.current[0]('1', {}));
    expect(id).toBe('2');
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
      wrapper: makeWrapper([makeBook({ id: '1' })]),
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
      wrapper: makeWrapper([makeBook({ id: '1' })]),
    });
    await act(() => result.current[0]('1', {}));
    expect(result.current[3]).toBe('Save failed');
  });
});

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context as ProgressContext } from '../../progress/context';
import type { ProgressList, UserProgressList } from '../../progress/type';
import { Context } from '../context';
import type { Book, BookList } from '../type';

import { useRegenChapters } from './use-regen-chapters';

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Dune',
    author: 'Herbert',
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

function makeWrapper(initialBooks: Book[] = [], initialProgress: ProgressList = {}) {
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
          }}
        >
          {children}
        </Context.Provider>
      </ProgressContext.Provider>
    );
  };
}

describe('useRegenChapters', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls POST /api/books/:id/regen-chapters', async () => {
    const updated = makeBook({ id: 'book-1', chapterCount: 5 });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
    );
    const { result } = renderHook(() => useRegenChapters(), {
      wrapper: makeWrapper([makeBook({ id: 'book-1' })]),
    });
    await act(() => result.current[0]('book-1'));
    expect(fetch).toHaveBeenCalledWith(
      `/api/books/${encodeURIComponent('book-1')}/regen-chapters`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('updates book in context on success', async () => {
    const updated = makeBook({ id: 'book-1', chapterCount: 5 });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
    );
    const { result } = renderHook(() => ({ hook: useRegenChapters(), ctx: useContext(Context) }), {
      wrapper: makeWrapper([makeBook({ id: 'book-1' })]),
    });
    await act(() => result.current.hook[0]('book-1'));
    expect(result.current.ctx.bookList['book-1'].chapterCount).toBe(5);
  });

  it('removes old book key when id changes after regen', async () => {
    const updated = makeBook({ id: 'new-id' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
    );
    const { result } = renderHook(() => ({ hook: useRegenChapters(), ctx: useContext(Context) }), {
      wrapper: makeWrapper([makeBook({ id: 'old-id' })]),
    });
    await act(() => result.current.hook[0]('old-id'));
    expect(result.current.ctx.bookList['old-id']).toBeUndefined();
    expect(result.current.ctx.bookList['new-id']).toBeDefined();
  });

  it('moves progress from old to new id in all user caches when book id changes', async () => {
    const initialProgress: ProgressList = {
      alice: { 'old-id': { document: 'old-id', percentage: 0.6 } },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeBook({ id: 'new-id' })),
      })
    );
    const { result } = renderHook(
      () => ({ hook: useRegenChapters(), ctx: useContext(ProgressContext) }),
      { wrapper: makeWrapper([makeBook({ id: 'old-id' })], initialProgress) }
    );
    await act(() => result.current.hook[0]('old-id'));
    expect(result.current.ctx.progressList['alice']['new-id']).toBeDefined();
    expect(result.current.ctx.progressList['alice']['old-id']).toBeUndefined();
  });

  it('sets error state on failed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderHook(() => useRegenChapters(), {
      wrapper: makeWrapper([makeBook({ id: 'book-1' })]),
    });
    await act(() => result.current[0]('book-1'));
    expect(result.current[2]).toBe(true);
  });
});

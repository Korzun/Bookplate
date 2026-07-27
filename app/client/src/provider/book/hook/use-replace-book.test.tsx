import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ValidationReport } from '~/lib/severity';

import { Context as ProgressContext } from '../../progress/context';
import type { ProgressList, UserProgressList } from '../../progress/type';
import { Context } from '../context';
import type { Book, BookList } from '../type';
import { useReplaceBook } from './use-replace-book';

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

function makeReport(overrides: Partial<ValidationReport> = {}): ValidationReport {
  return {
    valid: true,
    messages: [],
    counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
    threshold: 'ERROR',
    ...overrides,
  };
}

function makeFile(name = 'replacement.epub'): File {
  return new File(['content'], name, { type: 'application/epub+zip' });
}

type WrapperOptions = {
  initialBooks?: Book[];
  initialProgress?: ProgressList;
  setBookListFetched?: (fetched: boolean) => void;
  setBookListItems?: (
    updater: (prev: import('../type').DisplayUnit[]) => import('../type').DisplayUnit[]
  ) => void;
  setNextCursor?: (cursor: string | null) => void;
};

function makeWrapper({
  initialBooks = [],
  initialProgress = {},
  setBookListFetched = () => {},
  setBookListItems = () => {},
  setNextCursor = () => {},
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
            nextCursor: null,
            setBookListItems,
            setNextCursor,
            bookListFilter: {},
            setBookListFilter: () => {},
          }}
        >
          {children}
        </Context.Provider>
      </ProgressContext.Provider>
    );
  };
}

describe('useReplaceBook', () => {
  afterEach(() => vi.unstubAllGlobals());

  describe('validateReplacement', () => {
    it('posts to /api/books/:id/replace/validate and returns the parsed report', async () => {
      const report = makeReport({ counts: { FATAL: 0, ERROR: 1, WARNING: 0, INFO: 0, USAGE: 0 } });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(report) })
      );
      const { result } = renderHook(() => useReplaceBook(), {
        wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
      });

      let returned: ValidationReport | undefined;
      await act(async () => {
        returned = await result.current.validateReplacement('1', makeFile());
      });

      expect(fetch).toHaveBeenCalledWith(
        `/api/books/${encodeURIComponent('1')}/replace/validate`,
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
      );
      expect(returned).toEqual(report);
    });

    it('returns undefined when the response is not ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) })
      );
      const { result } = renderHook(() => useReplaceBook(), {
        wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
      });

      let returned: ValidationReport | undefined;
      await act(async () => {
        returned = await result.current.validateReplacement('1', makeFile());
      });

      expect(returned).toBeUndefined();
    });
  });

  describe('commitReplacement', () => {
    it('posts to /api/books/:id/replace and returns the updated book', async () => {
      const updated = makeBook({ id: '1', title: 'Replaced' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
      );
      const { result } = renderHook(() => useReplaceBook(), {
        wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
      });

      let returned: Book | undefined;
      await act(async () => {
        returned = await result.current.commitReplacement('1', makeFile());
      });

      expect(fetch).toHaveBeenCalledWith(
        `/api/books/${encodeURIComponent('1')}/replace`,
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
      );
      expect(returned).toEqual(updated);
    });

    it('updates the store with the returned book on success', async () => {
      const updated = makeBook({ id: '1', title: 'Replaced' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
      );
      const { result } = renderHook(() => ({ hook: useReplaceBook(), ctx: useContext(Context) }), {
        wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
      });

      await act(async () => {
        await result.current.hook.commitReplacement('1', makeFile());
      });

      expect(result.current.ctx.bookList['1'].title).toBe('Replaced');
    });

    it('removes the old key and renames the progress key when the returned id differs', async () => {
      const updated = makeBook({ id: '2', title: 'Replaced' });
      const initialProgress: ProgressList = {
        alice: { '1': { document: '1', percentage: 0.5 } },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
      );
      const { result } = renderHook(
        () => ({
          hook: useReplaceBook(),
          ctx: useContext(Context),
          progress: useContext(ProgressContext),
        }),
        { wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })], initialProgress }) }
      );

      await act(async () => {
        await result.current.hook.commitReplacement('1', makeFile());
      });

      expect(result.current.ctx.bookList['1']).toBeUndefined();
      expect(result.current.ctx.bookList['2']).toBeDefined();
      expect(result.current.progress.progressList['alice']['1']).toBeUndefined();
      expect(result.current.progress.progressList['alice']['2']).toBeDefined();
    });

    it('invalidates the book list pagination after a successful commit', async () => {
      const setBookListFetched = vi.fn();
      const setBookListItems = vi.fn();
      const setNextCursor = vi.fn();
      const updated = makeBook({ id: '1', title: 'Replaced' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
      );
      const { result } = renderHook(() => useReplaceBook(), {
        wrapper: makeWrapper({
          initialBooks: [makeBook({ id: '1' })],
          setBookListFetched,
          setBookListItems,
          setNextCursor,
        }),
      });

      await act(async () => {
        await result.current.commitReplacement('1', makeFile());
      });

      expect(setBookListFetched).toHaveBeenCalledWith(false);
      expect(setBookListItems).toHaveBeenCalled();
      expect(setNextCursor).toHaveBeenCalledWith(null);
    });

    it('returns undefined when the response is not ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) })
      );
      const { result } = renderHook(() => useReplaceBook(), {
        wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
      });

      let returned: Book | undefined;
      await act(async () => {
        returned = await result.current.commitReplacement('1', makeFile());
      });

      expect(returned).toBeUndefined();
    });

    it('does not send a second commit request while the first is still in flight', async () => {
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

      const { result } = renderHook(() => useReplaceBook(), {
        wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
      });

      act(() => {
        void result.current.commitReplacement('1', makeFile());
      });
      await waitFor(() => expect(result.current.committing).toBe(true));

      await act(() => result.current.commitReplacement('1', makeFile()));

      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});

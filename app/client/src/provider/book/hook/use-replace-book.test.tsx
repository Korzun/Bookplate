import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ValidationReport } from '~/lib/severity';
import { ApolloTestProvider } from '~/test-utils';

import { Context } from '../context';
import type { Book, BookList, MetadataFix } from '../type';
import type { ReplaceAnalysis } from './use-replace-book';
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

function makeFix(overrides: Partial<MetadataFix> = {}): MetadataFix {
  return {
    field: 'title',
    kind: 'trim',
    from: ' Dune ',
    to: 'Dune',
    changes: {},
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<ReplaceAnalysis> = {}): ReplaceAnalysis {
  return {
    ...makeReport(),
    autoFixes: [],
    proposals: [],
    ...overrides,
  };
}

function makeFile(name = 'replacement.epub'): File {
  return new File(['content'], name, { type: 'application/epub+zip' });
}

type WrapperOptions = {
  initialBooks?: Book[];
  setBookListFetched?: (fetched: boolean) => void;
  setBookListItems?: (
    updater: (prev: import('../type').DisplayUnit[]) => import('../type').DisplayUnit[]
  ) => void;
};

function makeWrapper({
  initialBooks = [],
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
      </ApolloTestProvider>
    );
  };
}

describe('useReplaceBook', () => {
  afterEach(() => vi.unstubAllGlobals());

  describe('analyzeReplacement', () => {
    it('posts to /api/books/:id/replace/analyze and returns the parsed analysis', async () => {
      const analysis = makeAnalysis({
        counts: { FATAL: 0, ERROR: 1, WARNING: 0, INFO: 0, USAGE: 0 },
        autoFixes: [makeFix({ kind: 'auto' })],
        proposals: [makeFix({ kind: 'proposal', field: 'author' })],
      });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(analysis) })
      );
      const { result } = renderHook(() => useReplaceBook(), {
        wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
      });

      let returned: ReplaceAnalysis | undefined;
      await act(async () => {
        returned = await result.current.analyzeReplacement('1', makeFile());
      });

      expect(fetch).toHaveBeenCalledWith(
        `/api/books/${encodeURIComponent('1')}/replace/analyze`,
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
      );
      expect(returned).toEqual(analysis);
      expect(returned?.autoFixes).toEqual(analysis.autoFixes);
      expect(returned?.proposals).toEqual(analysis.proposals);
    });

    it('returns undefined when the response is not ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) })
      );
      const { result } = renderHook(() => useReplaceBook(), {
        wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
      });

      let returned: ReplaceAnalysis | undefined;
      await act(async () => {
        returned = await result.current.analyzeReplacement('1', makeFile());
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
        returned = await result.current.commitReplacement('1', makeFile(), []);
      });

      expect(fetch).toHaveBeenCalledWith(
        `/api/books/${encodeURIComponent('1')}/replace`,
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
      );
      expect(returned).toEqual(updated);
    });

    it('appends acceptedFixKeys as a JSON-stringified field on the FormData', async () => {
      const updated = makeBook({ id: '1', title: 'Replaced' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
      );
      const appendSpy = vi.spyOn(FormData.prototype, 'append');
      const { result } = renderHook(() => useReplaceBook(), {
        wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
      });

      await act(async () => {
        await result.current.commitReplacement('1', makeFile(), ['title', 'author']);
      });

      expect(appendSpy).toHaveBeenCalledWith(
        'acceptedFixKeys',
        JSON.stringify(['title', 'author'])
      );
      appendSpy.mockRestore();
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
        await result.current.hook.commitReplacement('1', makeFile(), []);
      });

      expect(result.current.ctx.bookList['1'].title).toBe('Replaced');
    });

    it('removes the old bookList key when the returned id differs', async () => {
      const updated = makeBook({ id: '2', title: 'Replaced' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
      );
      const { result } = renderHook(() => ({ hook: useReplaceBook(), ctx: useContext(Context) }), {
        wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
      });

      await act(async () => {
        await result.current.hook.commitReplacement('1', makeFile(), []);
      });

      expect(result.current.ctx.bookList['1']).toBeUndefined();
      expect(result.current.ctx.bookList['2']).toBeDefined();
    });

    // Task 8 review round 2: `id` here is always the resolved raw id
    // (`UploadReplaceModal` is given `bookId={book.id}` by `page/book`), but
    // a book reached earlier via a Relay global id (the grid) can have its
    // `bookList` entry filed under THAT global-id key instead —
    // `useFetchBook` keys by the REQUESTED id, not `book.id`. The pre-fix
    // `next[id]`-only deletion never touched that alias: it's masked by the
    // immediate post-replace `navigate(path.book(newId))` (which populates
    // the NEW id's own entry correctly), but the stale, pre-replace copy
    // survives under the original global-id key forever — browsing back to
    // the book's original URL would silently show the pre-replace book.
    it('clears a stale alias entry (cached under a different key than its own id) after a replace', async () => {
      const updated = makeBook({ id: 'raw-1', title: 'Replaced' });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) })
      );
      const preReplace = makeBook({ id: 'raw-1', title: 'Dune' });
      const { result } = renderHook(
        () => ({ hook: useReplaceBook(), ctx: useContext(Context) }),
        // Filed under 'global-1' — a different key than the book's own raw
        // id ('raw-1') — exactly what a grid-originated (global-id)
        // navigation produces via `useFetchBook`.
        { wrapper: makeWrapperWithBookList({ 'global-1': preReplace }) }
      );

      await act(async () => {
        await result.current.hook.commitReplacement('raw-1', makeFile(), []);
      });

      expect(result.current.ctx.bookList['global-1']).toBeUndefined();
      expect(result.current.ctx.bookList['raw-1']).toBeDefined();
      expect(result.current.ctx.bookList['raw-1'].title).toBe('Replaced');
    });

    it('invalidates the cached book list items after a successful commit', async () => {
      const setBookListFetched = vi.fn();
      const setBookListItems = vi.fn();
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
        }),
      });

      await act(async () => {
        await result.current.commitReplacement('1', makeFile(), []);
      });

      expect(setBookListFetched).toHaveBeenCalledWith(false);
      expect(setBookListItems).toHaveBeenCalled();
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
        returned = await result.current.commitReplacement('1', makeFile(), []);
      });

      expect(returned).toBeUndefined();
    });

    it('captures the error message from a non-ok response into commitError', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          json: () => Promise.resolve({ error: 'Fingerprint collision' }),
        })
      );
      const { result } = renderHook(() => useReplaceBook(), {
        wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
      });

      let returned: Book | undefined;
      await act(async () => {
        returned = await result.current.commitReplacement('1', makeFile(), []);
      });

      expect(returned).toBeUndefined();
      expect(result.current.commitError).toBe('Fingerprint collision');
    });

    it('clears commitError at the start of a new commitReplacement call and on success', async () => {
      const updated = makeBook({ id: '1', title: 'Replaced' });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: 'Fingerprint collision' }),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(updated) });
      vi.stubGlobal('fetch', fetchMock);
      const { result } = renderHook(() => useReplaceBook(), {
        wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
      });

      await act(async () => {
        await result.current.commitReplacement('1', makeFile(), []);
      });
      expect(result.current.commitError).toBe('Fingerprint collision');

      await act(async () => {
        await result.current.commitReplacement('1', makeFile(), []);
      });
      expect(result.current.commitError).toBeUndefined();
    });

    it('does not send a second commit request while the first is still in flight', async () => {
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

      const { result } = renderHook(() => useReplaceBook(), {
        wrapper: makeWrapper({ initialBooks: [makeBook({ id: '1' })] }),
      });

      act(() => {
        void result.current.commitReplacement('1', makeFile(), []);
      });
      await waitFor(() => expect(result.current.committing).toBe(true));

      await act(() => result.current.commitReplacement('1', makeFile(), []));

      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});

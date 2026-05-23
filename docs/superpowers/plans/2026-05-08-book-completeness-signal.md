# Book Completeness Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `completeBookIds` set to BookProvider context so `useBook` re-fetches full data when a book is present from the list endpoint but missing detail fields.

**Architecture:** A `Set<string>` in context tracks which books have been individually fetched. `useFetchBook` marks a book complete on success. `useBook` triggers a fetch when the book is absent OR not complete. `useScanLibrary` and `useUploadBookList` clear the set after library mutations to force re-fetching.

**Tech Stack:** React Context API, React hooks, TypeScript, Vitest, @testing-library/react

---

### Task 1: Extend context and provider with completeness tracking

**Files:**
- Modify: `client/src/provider/book/context.ts`
- Modify: `client/src/provider/book/provider.tsx`

No tests for this task — it is pure type definition and state wire-up verified by later tasks.

- [ ] **Step 1: Add completeness fields to BookContext**

Replace the contents of `client/src/provider/book/context.ts`:

```typescript
import { createContext } from 'react';

import type { BookList } from './type';

export type BookContext = {
  bookList: BookList;
  bookListFetched: boolean;
  bookListLoading: boolean;
  bookListError: string | undefined;
  loadingByBookId: Record<string, boolean>;
  errorByBookId: Record<string, string | undefined>;
  completeBookIds: Set<string>;
  setBookList: (updater: (prev: BookList) => BookList) => void;
  setBookListFetched: (fetched: boolean) => void;
  setBookListLoading: (loading: boolean) => void;
  setBookListError: (error: string | undefined) => void;
  setLoadingForBook: (bookId: string, loading: boolean) => void;
  setErrorForBook: (bookId: string, error: string | undefined) => void;
  setBookComplete: (bookId: string) => void;
  clearCompleteBookIds: () => void;
};

export const Context = createContext<BookContext>({
  bookList: {},
  bookListFetched: false,
  bookListLoading: false,
  bookListError: undefined,
  loadingByBookId: {},
  errorByBookId: {},
  completeBookIds: new Set(),
  setBookList: () => {},
  setBookListFetched: () => {},
  setBookListLoading: () => {},
  setBookListError: () => {},
  setLoadingForBook: () => {},
  setErrorForBook: () => {},
  setBookComplete: () => {},
  clearCompleteBookIds: () => {},
});
```

- [ ] **Step 2: Initialize completeness state in BookProvider**

Replace the contents of `client/src/provider/book/provider.tsx`:

```typescript
import { useCallback, useState, type ReactNode } from 'react';

import { Context } from './context';
import type { BookList } from './type';

export type BookProviderProps = { children: ReactNode };
export const BookProvider = ({ children }: BookProviderProps) => {
  const [bookList, setBookListRaw] = useState<BookList>({});
  const [bookListFetched, setBookListFetched] = useState(false);
  const [bookListLoading, setBookListLoading] = useState(false);
  const [bookListError, setBookListError] = useState<string | undefined>();
  const [loadingByBookId, setLoadingByBookIdRaw] = useState<Record<string, boolean>>({});
  const [errorByBookId, setErrorByBookIdRaw] = useState<Record<string, string | undefined>>({});
  const [completeBookIds, setCompleteBookIdsRaw] = useState(new Set<string>());

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

  const setBookComplete = useCallback((bookId: string) => {
    setCompleteBookIdsRaw((prev) => new Set([...prev, bookId]));
  }, []);

  const clearCompleteBookIds = useCallback(() => {
    setCompleteBookIdsRaw(new Set());
  }, []);

  return (
    <Context.Provider
      value={{
        bookList,
        bookListFetched,
        bookListLoading,
        bookListError,
        loadingByBookId,
        errorByBookId,
        completeBookIds,
        setBookList,
        setBookListFetched,
        setBookListLoading,
        setBookListError,
        setLoadingForBook,
        setErrorForBook,
        setBookComplete,
        clearCompleteBookIds,
      }}
    >
      {children}
    </Context.Provider>
  );
};
```

- [ ] **Step 3: Run type check**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/provider/book/context.ts client/src/provider/book/provider.tsx
git commit -m "feat: add completeBookIds tracking to book context"
```

---

### Task 2: Mark books complete in useFetchBook

**Files:**
- Modify: `client/src/provider/book/hook/use-fetch-book.ts`
- Create: `client/src/provider/book/hook/use-fetch-book.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/provider/book/hook/use-fetch-book.test.tsx`:

```typescript
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false })
    );

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd client && npx vitest run src/provider/book/hook/use-fetch-book.test.tsx
```

Expected: 3 failures — `setBookComplete` is not yet called in `useFetchBook`.

- [ ] **Step 3: Implement — call setBookComplete on success**

Replace the contents of `client/src/provider/book/hook/use-fetch-book.ts`:

```typescript
import { useCallback, useContext } from 'react';

import { Context } from '../context';
import type { Book } from '../type';

export type FetchBook = (bookId: string) => Promise<void>;

export const useFetchBook = (): FetchBook => {
  const { loadingByBookId, setBookList, setLoadingForBook, setErrorForBook, setBookComplete } =
    useContext(Context);

  return useCallback(
    async (bookId: string) => {
      if (loadingByBookId[bookId]) return;

      setLoadingForBook(bookId, true);
      setErrorForBook(bookId, undefined);
      try {
        const response = await fetch(`/api/books/${encodeURIComponent(bookId)}`);
        if (!response.ok) throw new Error('Book not found');
        const book = await (response.json() as Promise<Book>);
        setBookList((prev) => ({ ...prev, [book.id]: book }));
        setBookComplete(bookId);
      } catch (err) {
        setErrorForBook(bookId, err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoadingForBook(bookId, false);
      }
    },
    [loadingByBookId, setBookList, setLoadingForBook, setErrorForBook, setBookComplete]
  );
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd client && npx vitest run src/provider/book/hook/use-fetch-book.test.tsx
```

Expected: 3 passing.

- [ ] **Step 5: Run full test suite**

```bash
cd client && npm run test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add client/src/provider/book/hook/use-fetch-book.ts client/src/provider/book/hook/use-fetch-book.test.tsx
git commit -m "feat: mark books complete in useFetchBook after successful fetch"
```

---

### Task 3: Trigger fetch for incomplete books in useBook

**Files:**
- Modify: `client/src/provider/book/hook/use-book.ts`
- Create: `client/src/provider/book/hook/use-book.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/provider/book/hook/use-book.test.tsx`:

```typescript
import { act, renderHook, waitFor } from '@testing-library/react';
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
    ...overrides,
  };
}

function makeWrapper(initialBooks: Book[] = [], initialCompleteIds: Set<string> = new Set()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>(
      Object.fromEntries(initialBooks.map((b) => [b.id, b]))
    );
    const [loadingByBookId, setLoadingByBookIdRaw] = useState<Record<string, boolean>>({});
    const [errorByBookId, setErrorByBookIdRaw] = useState<Record<string, string | undefined>>({});
    const [completeBookIds, setCompleteBookIdsRaw] = useState(initialCompleteIds);

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
    const setBookComplete = useCallback((bookId: string) => {
      setCompleteBookIdsRaw((prev) => new Set([...prev, bookId]));
    }, []);

    return (
      <Context.Provider
        value={{
          bookList,
          bookListFetched: true,
          bookListLoading: false,
          bookListError: undefined,
          loadingByBookId,
          errorByBookId,
          completeBookIds,
          setBookList,
          setBookListFetched: () => {},
          setBookListLoading: () => {},
          setBookListError: () => {},
          setLoadingForBook,
          setErrorForBook,
          setBookComplete,
          clearCompleteBookIds: () => {},
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

import { useBook } from './use-book';

describe('useBook', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('triggers fetch when book is absent from context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeBook({ id: '1' })),
      })
    );

    renderHook(() => useBook('1'), { wrapper: makeWrapper() });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/books/1'));
  });

  it('triggers fetch when book exists in context but is not complete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeBook({ id: '1' })),
      })
    );

    renderHook(() => useBook('1'), {
      wrapper: makeWrapper([makeBook({ id: '1' })], new Set()),
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/books/1'));
  });

  it('does not trigger fetch when book exists and is complete', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    renderHook(() => useBook('1'), {
      wrapper: makeWrapper([makeBook({ id: '1' })], new Set(['1'])),
    });

    await act(async () => {});

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns summary data immediately before fetch starts for incomplete book', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    const book = makeBook({ id: '1', title: 'Dune' });
    const { result } = renderHook(() => useBook('1'), {
      wrapper: makeWrapper([book], new Set()),
    });

    const [returnedBook] = result.current;
    expect(returnedBook?.title).toBe('Dune');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd client && npx vitest run src/provider/book/hook/use-book.test.tsx
```

Expected: "triggers fetch when book exists in context but is not complete" fails — `fetch` is not called because the current condition only checks `bookList[bookId] === undefined`.

- [ ] **Step 3: Implement — extend trigger condition in useBook**

Replace the contents of `client/src/provider/book/hook/use-book.ts`:

```typescript
import { useContext, useEffect, useMemo } from 'react';

import { Context } from '../context';
import type { Book } from '../type';

import { useFetchBook } from './use-fetch-book';

export type UseBook =
  | [Book, false, false, undefined]
  | [Book, true, false, undefined]
  | [undefined, true, false, undefined]
  | [undefined, false, true, undefined]
  | [undefined, false, true, string];

export const useBook = (bookId: string): UseBook => {
  const { bookList, loadingByBookId, errorByBookId, completeBookIds } = useContext(Context);
  const fetchBook = useFetchBook();

  const loading = loadingByBookId[bookId] ?? false;
  const errorMessage = errorByBookId[bookId];

  useEffect(() => {
    if (
      !loading &&
      errorMessage === undefined &&
      (bookList[bookId] === undefined || !completeBookIds.has(bookId))
    ) {
      void fetchBook(bookId);
    }
  }, [bookId, bookList, loading, errorMessage, fetchBook, completeBookIds]);

  return useMemo(() => {
    const book = bookList[bookId];
    const isLoading = loading || (!loading && errorMessage === undefined && book === undefined);
    if (errorMessage !== undefined) return [undefined, false, true, errorMessage] as UseBook;
    if (book === undefined) return [undefined, isLoading, false, undefined] as UseBook;
    return [book, loading, false, undefined] as UseBook;
  }, [bookList, loading, errorMessage, bookId]);
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd client && npx vitest run src/provider/book/hook/use-book.test.tsx
```

Expected: 4 passing.

- [ ] **Step 5: Run full test suite**

```bash
cd client && npm run test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add client/src/provider/book/hook/use-book.ts client/src/provider/book/hook/use-book.test.tsx
git commit -m "feat: trigger fetch for incomplete books in useBook"
```

---

### Task 4: Clear completeness on library scan

**Files:**
- Modify: `client/src/provider/book/hook/use-scan-library.ts`
- Create: `client/src/provider/book/hook/use-scan-library.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/provider/book/hook/use-scan-library.test.tsx`:

```typescript
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { BookList } from '../type';

function makeWrapper(clearCompleteBookIds: () => void = () => {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>({});
    const [bookListLoading, setBookListLoadingState] = useState(false);

    const setBookList = useCallback(
      (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
      []
    );
    const setBookListLoading = useCallback((v: boolean) => setBookListLoadingState(v), []);

    return (
      <Context.Provider
        value={{
          bookList,
          bookListFetched: false,
          bookListLoading,
          bookListError: undefined,
          loadingByBookId: {},
          errorByBookId: {},
          completeBookIds: new Set(),
          setBookList,
          setBookListFetched: () => {},
          setBookListLoading,
          setBookListError: () => {},
          setLoadingForBook: () => {},
          setErrorForBook: () => {},
          setBookComplete: () => {},
          clearCompleteBookIds,
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

import { useScanLibrary } from './use-scan-library';

describe('useScanLibrary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('clears complete book ids on successful scan', async () => {
    const mockClear = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ imported: ['1'], removed: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        })
    );

    const { result } = renderHook(() => useScanLibrary(), {
      wrapper: makeWrapper(mockClear),
    });

    await act(() => result.current[0]());

    expect(mockClear).toHaveBeenCalled();
  });

  it('does not clear complete book ids on failed scan', async () => {
    const mockClear = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useScanLibrary(), {
      wrapper: makeWrapper(mockClear),
    });

    await act(() => result.current[0]());

    expect(mockClear).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd client && npx vitest run src/provider/book/hook/use-scan-library.test.tsx
```

Expected: "clears complete book ids on successful scan" fails — `clearCompleteBookIds` is not yet called.

- [ ] **Step 3: Implement — call clearCompleteBookIds on scan success**

Replace the contents of `client/src/provider/book/hook/use-scan-library.ts`:

```typescript
import { useCallback, useContext, useMemo, useState } from 'react';

import { Context } from '../context';

import { useFetchBookList } from './use-fetch-book-list';

export type ScanResult = {
  imported: string[];
  removed: string[];
};

export type ScanLibrary = () => Promise<void>;
export type UseScanLibrary =
  | [ScanLibrary, undefined, false, false, undefined]
  | [ScanLibrary, undefined, true, false, undefined]
  | [ScanLibrary, ScanResult, false, false, undefined]
  | [ScanLibrary, undefined, false, true, undefined]
  | [ScanLibrary, undefined, false, true, string];
export const useScanLibrary = (): UseScanLibrary => {
  const { clearCompleteBookIds } = useContext(Context);
  const fetchBookList = useFetchBookList();
  const [scanResult, setScanResult] = useState<ScanResult | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const scanLibrary: ScanLibrary = useCallback(async () => {
    if (loading === true) {
      return;
    }

    setLoading(true);
    setError(false);
    setErrorMessage(undefined);
    setScanResult(undefined);

    try {
      const response = await fetch('/api/books/scan', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Scan failed');
      }
      const scanResult = await (response.json() as Promise<ScanResult>);
      setScanResult(scanResult);
      clearCompleteBookIds();
      fetchBookList();
    } catch (err) {
      setError(true);
      if (err instanceof Error) {
        setErrorMessage(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchBookList, clearCompleteBookIds]);

  return useMemo(
    () => [scanLibrary, scanResult, loading, error, errorMessage] as UseScanLibrary,
    [scanLibrary, scanResult, loading, error, errorMessage]
  );
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd client && npx vitest run src/provider/book/hook/use-scan-library.test.tsx
```

Expected: 2 passing.

- [ ] **Step 5: Run full test suite**

```bash
cd client && npm run test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add client/src/provider/book/hook/use-scan-library.ts client/src/provider/book/hook/use-scan-library.test.tsx
git commit -m "feat: clear complete book ids after library scan"
```

---

### Task 5: Clear completeness on book upload

**Files:**
- Modify: `client/src/provider/book/hook/use-upload-book-list.ts`
- Create: `client/src/provider/book/hook/use-upload-book-list.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/provider/book/hook/use-upload-book-list.test.tsx`:

```typescript
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { BookList } from '../type';

function makeWrapper(clearCompleteBookIds: () => void = () => {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>({});
    const [bookListLoading, setBookListLoadingState] = useState(false);

    const setBookList = useCallback(
      (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
      []
    );
    const setBookListLoading = useCallback((v: boolean) => setBookListLoadingState(v), []);

    return (
      <Context.Provider
        value={{
          bookList,
          bookListFetched: false,
          bookListLoading,
          bookListError: undefined,
          loadingByBookId: {},
          errorByBookId: {},
          completeBookIds: new Set(),
          setBookList,
          setBookListFetched: () => {},
          setBookListLoading,
          setBookListError: () => {},
          setLoadingForBook: () => {},
          setErrorForBook: () => {},
          setBookComplete: () => {},
          clearCompleteBookIds,
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

function makeFileList(...names: string[]): FileList {
  const files = names.map((name) => new File(['content'], name));
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  return dt.files;
}

import { useUploadBookList } from './use-upload-book-list';

describe('useUploadBookList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('clears complete book ids on successful upload', async () => {
    const mockClear = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ imported: ['1'], skipped: [], errors: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        })
    );

    const { result } = renderHook(() => useUploadBookList(), {
      wrapper: makeWrapper(mockClear),
    });

    await act(() => result.current[0](makeFileList('book.epub')));

    expect(mockClear).toHaveBeenCalled();
  });

  it('does not clear complete book ids on failed upload', async () => {
    const mockClear = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Upload failed' }),
      })
    );

    const { result } = renderHook(() => useUploadBookList(), {
      wrapper: makeWrapper(mockClear),
    });

    await act(() => result.current[0](makeFileList('book.epub')));

    expect(mockClear).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd client && npx vitest run src/provider/book/hook/use-upload-book-list.test.tsx
```

Expected: "clears complete book ids on successful upload" fails — `clearCompleteBookIds` is not yet called.

- [ ] **Step 3: Implement — call clearCompleteBookIds on upload success**

Replace the contents of `client/src/provider/book/hook/use-upload-book-list.ts`:

```typescript
import { useCallback, useContext, useMemo, useState } from 'react';

import { Context } from '../context';
import type { UploadResult } from '../type';

import { useFetchBookList } from './use-fetch-book-list';

export type UseUploadBookList = [
  (files: FileList) => Promise<void>,
  UploadResult | undefined,
  boolean,
  boolean,
  string | undefined,
];
export const useUploadBookList = (): UseUploadBookList => {
  const { clearCompleteBookIds } = useContext(Context);
  const fetchBookList = useFetchBookList();
  const [uploadResult, setUploadResult] = useState<UploadResult | undefined>();
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const uploadBooks = useCallback(
    async (files: FileList): Promise<void> => {
      if (loading === true) {
        return;
      }

      setLoading(true);
      setError(false);
      setErrorMessage(undefined);
      setUploadResult(undefined);

      try {
        const formData = new FormData();
        for (const file of files) {
          formData.append('files', file);
        }

        const response = await fetch('/api/books/upload', { method: 'POST', body: formData });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? 'Upload failed');
        }
        const uploadResult = await (response.json() as Promise<UploadResult>);
        setUploadResult(uploadResult);
        clearCompleteBookIds();
        fetchBookList();
      } catch (error) {
        setError(true);
        if (error instanceof Error) {
          setErrorMessage(error.message);
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchBookList, clearCompleteBookIds]
  );

  return useMemo(
    () => [uploadBooks, uploadResult, loading, error, errorMessage],
    [uploadBooks, uploadResult, loading, error, errorMessage]
  );
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd client && npx vitest run src/provider/book/hook/use-upload-book-list.test.tsx
```

Expected: 2 passing.

- [ ] **Step 5: Run full test suite and lint**

```bash
cd client && npm run test && npm run lint
```

Expected: all passing, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/provider/book/hook/use-upload-book-list.ts client/src/provider/book/hook/use-upload-book-list.test.tsx
git commit -m "feat: clear complete book ids after book upload"
```

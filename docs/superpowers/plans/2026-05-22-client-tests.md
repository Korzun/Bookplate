# Client Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete one below-threshold test file, repair one existing test, and add 17 new test files covering all untested logic-bearing client code.

**Architecture:** Task 0 (triage) runs first and must complete before anything else. Tasks 1–4 are fully independent — they write to separate files and can be dispatched as parallel subagents. Each task writes test files for existing source code, so there is no implementation step; the workflow per file is: write the test → run it → confirm it passes → commit.

**Tech Stack:** React, Vitest, `@testing-library/react`, `@testing-library/user-event`, `vi.stubGlobal` for fetch mocking, `vi.mock` for module mocking, JSS (react-jss) for styles.

---

## Shared helpers reference

Every test file that needs a `Book` object uses this factory (copy it into each file — do not import from a shared module):

```ts
import type { Book } from '../type'; // adjust relative path as needed

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
```

The full `BookContext` shape (for context wrappers):

```ts
{
  bookList, bookListFetched, bookListLoading, bookListError,
  loadingByBookId, errorByBookId, completeBookIds,
  setBookList, setBookListFetched, setBookListLoading, setBookListError,
  setLoadingForBook, setErrorForBook, setBookComplete, clearCompleteBookIds,
}
```

Run command for a single test file: `cd client && npx vitest run <path-relative-to-client>`

Run all tests: `cd client && npx vitest run`

---

## Task 0: Triage — delete + repair existing tests

**Files:**
- Delete: `client/src/provider/theme/provider.test.tsx`
- Modify: `client/src/provider/user/hook/use-user-list.test.tsx`

- [ ] **Step 1: Delete the theme provider test**

```bash
rm client/src/provider/theme/provider.test.tsx
```

Reason: the file tests only that static color/spacing string constants pass through JSS — no conditional logic, no behaviour.

- [ ] **Step 2: Fix the fetch mock in use-user-list.test.tsx**

In `client/src/provider/user/hook/use-user-list.test.tsx`, find the first test:

```ts
it('returns empty list and default state initially', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) }));
```

Change the mock to include `ok: true` (consistent with every other hook test):

```ts
it('returns empty list and default state initially', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
```

- [ ] **Step 3: Run the affected test file**

```bash
cd client && npx vitest run src/provider/user/hook/use-user-list.test.tsx
```

Expected: all 3 tests pass.

- [ ] **Step 4: Run the full suite to confirm nothing broke**

```bash
cd client && npx vitest run
```

Expected: all tests pass (one fewer than before because provider.test.tsx was deleted).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: triage existing tests — delete theme snapshot, fix fetch mock"
```

---

## Task 1: Group 1 — utils + auth/user hooks

**Files:**
- Create: `client/src/provider/book/util.test.ts`
- Create: `client/src/provider/user/hook/util.test.ts`
- Create: `client/src/provider/auth/hook/use-logout.test.tsx`
- Create: `client/src/provider/user/hook/use-user.test.ts`

### 1a — `provider/book/util.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// client/src/provider/book/util.test.ts
import { describe, expect, it } from 'vitest';

import type { Book } from './type';
import { bookSort } from './util';

function makeBook(title: string): Book {
  return {
    id: title,
    title,
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
  };
}

describe('bookSort', () => {
  it('returns negative when title a comes before b', () => {
    expect(bookSort(makeBook('Apple'), makeBook('Banana'))).toBeLessThan(0);
  });

  it('returns positive when title a comes after b', () => {
    expect(bookSort(makeBook('Banana'), makeBook('Apple'))).toBeGreaterThan(0);
  });

  it('returns 0 for equal titles', () => {
    expect(bookSort(makeBook('Dune'), makeBook('Dune'))).toBe(0);
  });
});
```

- [ ] **Step 2: Run**

```bash
cd client && npx vitest run src/provider/book/util.test.ts
```

Expected: 3 tests pass.

### 1b — `provider/user/hook/util.test.ts`

- [ ] **Step 3: Write the test file**

```ts
// client/src/provider/user/hook/util.test.ts
import { describe, expect, it } from 'vitest';

import type { UserList } from '../type';
import { removeUserByUsername } from './util';

describe('removeUserByUsername', () => {
  it('removes the named user and leaves others intact', () => {
    const list: UserList = {
      alice: { username: 'alice', progressCount: 0 },
      bob: { username: 'bob', progressCount: 1 },
    };
    expect(removeUserByUsername('alice', list)).toEqual({
      bob: { username: 'bob', progressCount: 1 },
    });
  });

  it('returns unchanged list when username is absent', () => {
    const list: UserList = { bob: { username: 'bob', progressCount: 1 } };
    expect(removeUserByUsername('alice', list)).toEqual(list);
  });

  it('returns empty object when removing the only user', () => {
    const list: UserList = { alice: { username: 'alice', progressCount: 0 } };
    expect(removeUserByUsername('alice', list)).toEqual({});
  });
});
```

- [ ] **Step 4: Run**

```bash
cd client && npx vitest run src/provider/user/hook/util.test.ts
```

Expected: 3 tests pass.

### 1c — `provider/auth/hook/use-logout.test.tsx`

- [ ] **Step 5: Write the test file**

`useLogout` sets `window.location.href = '/login'` on success. jsdom's `window.location` is read-only by default, so it must be replaced with a writable stub before each test.

```tsx
// client/src/provider/auth/hook/use-logout.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLogout } from './use-logout';

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: { href: '' },
    writable: true,
    configurable: true,
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('useLogout', () => {
  it('returns initial state', () => {
    const { result } = renderHook(() => useLogout());
    const [logout, loading, error, errorMessage] = result.current;
    expect(typeof logout).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('calls POST /logout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
    const { result } = renderHook(() => useLogout());
    await act(() => result.current[0]());
    expect(fetch).toHaveBeenCalledWith('/logout', { method: 'POST' });
  });

  it('sets loading to true while fetch is in flight', async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }))
    );
    const { result } = renderHook(() => useLogout());
    act(() => { void result.current[0](); });
    expect(result.current[1]).toBe(true);
    resolve({});
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  it('redirects to /login on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
    const { result } = renderHook(() => useLogout());
    await act(() => result.current[0]());
    expect(window.location.href).toBe('/login');
  });

  it('sets error state when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')));
    const { result } = renderHook(() => useLogout());
    await act(() => result.current[0]());
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Network down');
  });

  it('resets loading to false after an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')));
    const { result } = renderHook(() => useLogout());
    await act(() => result.current[0]());
    expect(result.current[1]).toBe(false);
  });
});
```

- [ ] **Step 6: Run**

```bash
cd client && npx vitest run src/provider/auth/hook/use-logout.test.tsx
```

Expected: 6 tests pass.

### 1d — `provider/user/hook/use-user.test.ts`

`useUser` delegates to `useUserList` — mock that module rather than wiring up a full context.

- [ ] **Step 7: Write the test file**

```ts
// client/src/provider/user/hook/use-user.test.ts
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { UseUserList } from './use-user-list';
import { useUser } from './use-user';

vi.mock('./use-user-list');

const { useUserList } = await import('./use-user-list');
const mockUseUserList = vi.mocked(useUserList);

function stubList(tuple: UseUserList) {
  mockUseUserList.mockReturnValue(tuple);
}

describe('useUser', () => {
  it('returns the user when found in the list', () => {
    stubList([[{ username: 'alice', progressCount: 2 }], false, false, undefined]);
    const { result } = renderHook(() => useUser('alice'));
    expect(result.current[0]).toEqual({ username: 'alice', progressCount: 2 });
    expect(result.current[1]).toBe(false);
    expect(result.current[2]).toBe(false);
    expect(result.current[3]).toBeUndefined();
  });

  it('returns loading state when list is loading and user is absent', () => {
    stubList([[], true, false, undefined]);
    const { result } = renderHook(() => useUser('alice'));
    expect(result.current[0]).toBeUndefined();
    expect(result.current[1]).toBe(true);
    expect(result.current[2]).toBe(false);
  });

  it('returns unknown-user error when list loaded but user absent', () => {
    stubList([[{ username: 'bob', progressCount: 0 }], false, false, undefined]);
    const { result } = renderHook(() => useUser('alice'));
    expect(result.current[0]).toBeUndefined();
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Unknown user alice');
  });

  it('propagates error from useUserList', () => {
    stubList([[], false, true, 'Fetch failed']);
    const { result } = renderHook(() => useUser('alice'));
    expect(result.current[0]).toBeUndefined();
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Fetch failed');
  });

  it('returns user alongside loading when list is refreshing', () => {
    stubList([[{ username: 'alice', progressCount: 0 }], true, false, undefined]);
    const { result } = renderHook(() => useUser('alice'));
    expect(result.current[0]).toEqual({ username: 'alice', progressCount: 0 });
    expect(result.current[1]).toBe(true);
    expect(result.current[2]).toBe(false);
  });
});
```

- [ ] **Step 8: Run**

```bash
cd client && npx vitest run src/provider/user/hook/use-user.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 9: Commit**

```bash
git add client/src/provider/book/util.test.ts \
        client/src/provider/user/hook/util.test.ts \
        client/src/provider/auth/hook/use-logout.test.tsx \
        client/src/provider/user/hook/use-user.test.ts
git commit -m "test: add tests for book/user utils, useLogout, useUser"
```

---

## Task 2: Group 2 — book read hooks

**Files:**
- Create: `client/src/provider/book/hook/use-series-list.test.ts`
- Create: `client/src/provider/book/hook/use-standalone-book-list.test.ts`
- Create: `client/src/provider/book/hook/use-book-list.test.tsx`
- Create: `client/src/provider/book/hook/use-fetch-book-list.test.tsx`

### 2a — `use-series-list.test.ts`

`useSeriesList` delegates to `useBookList` — mock that module.

- [ ] **Step 1: Write the test file**

```ts
// client/src/provider/book/hook/use-series-list.test.ts
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Book } from '../type';
import type { UseBookList } from './use-book-list';
import { useSeriesList } from './use-series-list';

vi.mock('./use-book-list');

const { useBookList } = await import('./use-book-list');
const mockUseBookList = vi.mocked(useBookList);

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Title', author: 'Author', fileAs: '', publisher: '',
    series: '', seriesIndex: 0, subjects: [], identifiers: [],
    hasCover: false, size: 0, addedAt: '2024-01-01', ...overrides,
  };
}

function stubList(tuple: UseBookList) {
  mockUseBookList.mockReturnValue(tuple);
}

describe('useSeriesList', () => {
  it('returns empty array when there are no books', () => {
    stubList([[], false, false, undefined]);
    const { result } = renderHook(() => useSeriesList());
    expect(result.current[0]).toEqual([]);
  });

  it('excludes books with no series', () => {
    stubList([[makeBook({ id: '1', series: '' })], false, false, undefined]);
    const { result } = renderHook(() => useSeriesList());
    expect(result.current[0]).toEqual([]);
  });

  it('groups books by series name', () => {
    stubList([[
      makeBook({ id: '1', series: 'Dune', seriesIndex: 1 }),
      makeBook({ id: '2', series: 'Foundation', seriesIndex: 1 }),
    ], false, false, undefined]);
    const { result } = renderHook(() => useSeriesList());
    expect(result.current[0]).toHaveLength(2);
  });

  it('sorts books within a series by seriesIndex ascending', () => {
    stubList([[
      makeBook({ id: '3', series: 'Dune', seriesIndex: 3 }),
      makeBook({ id: '1', series: 'Dune', seriesIndex: 1 }),
      makeBook({ id: '2', series: 'Dune', seriesIndex: 2 }),
    ], false, false, undefined]);
    const { result } = renderHook(() => useSeriesList());
    const [, books] = result.current[0][0];
    expect(books.map((b) => b.seriesIndex)).toEqual([1, 2, 3]);
  });

  it('sorts series entries alphabetically', () => {
    stubList([[
      makeBook({ id: '1', series: 'Foundation', seriesIndex: 1 }),
      makeBook({ id: '2', series: 'Dune', seriesIndex: 1 }),
    ], false, false, undefined]);
    const { result } = renderHook(() => useSeriesList());
    expect(result.current[0][0][0]).toBe('Dune');
    expect(result.current[0][1][0]).toBe('Foundation');
  });

  it('passes through loading state', () => {
    stubList([[], true, false, undefined]);
    const { result } = renderHook(() => useSeriesList());
    expect(result.current[1]).toBe(true);
    expect(result.current[2]).toBe(false);
  });

  it('passes through error state', () => {
    stubList([[], false, true, 'Fetch failed']);
    const { result } = renderHook(() => useSeriesList());
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Fetch failed');
  });
});
```

- [ ] **Step 2: Run**

```bash
cd client && npx vitest run src/provider/book/hook/use-series-list.test.ts
```

Expected: 7 tests pass.

### 2b — `use-standalone-book-list.test.ts`

- [ ] **Step 3: Write the test file**

```ts
// client/src/provider/book/hook/use-standalone-book-list.test.ts
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Book } from '../type';
import type { UseBookList } from './use-book-list';
import { useStandaloneBookList } from './use-standalone-book-list';

vi.mock('./use-book-list');

const { useBookList } = await import('./use-book-list');
const mockUseBookList = vi.mocked(useBookList);

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Title', author: 'Author', fileAs: '', publisher: '',
    series: '', seriesIndex: 0, subjects: [], identifiers: [],
    hasCover: false, size: 0, addedAt: '2024-01-01', ...overrides,
  };
}

function stubList(tuple: UseBookList) {
  mockUseBookList.mockReturnValue(tuple);
}

describe('useStandaloneBookList', () => {
  it('returns only books with no series', () => {
    stubList([[
      makeBook({ id: '1', series: '' }),
      makeBook({ id: '2', series: 'Dune' }),
    ], false, false, undefined]);
    const { result } = renderHook(() => useStandaloneBookList());
    expect(result.current[0]).toHaveLength(1);
    expect(result.current[0][0].id).toBe('1');
  });

  it('returns all books when none belong to a series', () => {
    stubList([[
      makeBook({ id: '1', series: '' }),
      makeBook({ id: '2', series: '' }),
    ], false, false, undefined]);
    const { result } = renderHook(() => useStandaloneBookList());
    expect(result.current[0]).toHaveLength(2);
  });

  it('returns empty array when all books belong to a series', () => {
    stubList([[makeBook({ id: '1', series: 'Dune' })], false, false, undefined]);
    const { result } = renderHook(() => useStandaloneBookList());
    expect(result.current[0]).toEqual([]);
  });

  it('returns empty array when there are no books', () => {
    stubList([[], false, false, undefined]);
    const { result } = renderHook(() => useStandaloneBookList());
    expect(result.current[0]).toEqual([]);
  });

  it('passes through loading state', () => {
    stubList([[], true, false, undefined]);
    const { result } = renderHook(() => useStandaloneBookList());
    expect(result.current[1]).toBe(true);
  });

  it('passes through error state', () => {
    stubList([[], false, true, 'Fetch failed']);
    const { result } = renderHook(() => useStandaloneBookList());
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Fetch failed');
  });
});
```

- [ ] **Step 4: Run**

```bash
cd client && npx vitest run src/provider/book/hook/use-standalone-book-list.test.ts
```

Expected: 6 tests pass.

### 2c — `use-book-list.test.tsx`

`useBookList` uses context directly and internally calls `useFetchBookList`. The wrapper must provide full writable BookContext state. Stub fetch to prevent real network calls.

- [ ] **Step 5: Write the test file**

```tsx
// client/src/provider/book/hook/use-book-list.test.tsx
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList } from '../type';

import { useBookList } from './use-book-list';

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Title', author: 'Author', fileAs: '', publisher: '',
    series: '', seriesIndex: 0, subjects: [], identifiers: [],
    hasCover: false, size: 0, addedAt: '2024-01-01', ...overrides,
  };
}

function makeWrapper({
  initialBooks = {} as BookList,
  bookListFetched = false,
  bookListLoading = false,
  bookListError = undefined as string | undefined,
} = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>(initialBooks);
    const [fetched, setFetched] = useState(bookListFetched);
    const [loading, setLoading] = useState(bookListLoading);
    const [error, setError] = useState<string | undefined>(bookListError);
    const setBookList = useCallback(
      (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
      []
    );
    return (
      <Context.Provider value={{
        bookList, bookListFetched: fetched, bookListLoading: loading, bookListError: error,
        loadingByBookId: {}, errorByBookId: {}, completeBookIds: new Set(),
        setBookList, setBookListFetched: setFetched, setBookListLoading: setLoading,
        setBookListError: setError, setLoadingForBook: () => {}, setErrorForBook: () => {},
        setBookComplete: () => {}, clearCompleteBookIds: () => {},
      }}>
        {children}
      </Context.Provider>
    );
  };
}

describe('useBookList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('triggers a fetch when bookListFetched is false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    renderHook(() => useBookList(), { wrapper: makeWrapper() });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/books'));
  });

  it('does not fetch when bookListFetched is already true', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    renderHook(() => useBookList(), { wrapper: makeWrapper({ bookListFetched: true }) });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch while bookListLoading is true', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    renderHook(() => useBookList(), { wrapper: makeWrapper({ bookListLoading: true }) });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns books sorted alphabetically by title', () => {
    vi.stubGlobal('fetch', vi.fn()); // prevent auto-fetch side-effect
    const books: BookList = {
      '1': makeBook({ id: '1', title: 'Zoe' }),
      '2': makeBook({ id: '2', title: 'Apple' }),
      '3': makeBook({ id: '3', title: 'Mango' }),
    };
    const { result } = renderHook(() => useBookList(), {
      wrapper: makeWrapper({ initialBooks: books, bookListFetched: true }),
    });
    expect(result.current[0].map((b) => b.title)).toEqual(['Apple', 'Mango', 'Zoe']);
  });

  it('passes through loading state', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { result } = renderHook(() => useBookList(), {
      wrapper: makeWrapper({ bookListLoading: true }),
    });
    expect(result.current[1]).toBe(true);
    expect(result.current[2]).toBe(false);
  });

  it('passes through error state', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { result } = renderHook(() => useBookList(), {
      wrapper: makeWrapper({ bookListError: 'Failed to fetch books', bookListFetched: true }),
    });
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Failed to fetch books');
  });
});
```

- [ ] **Step 6: Run**

```bash
cd client && npx vitest run src/provider/book/hook/use-book-list.test.tsx
```

Expected: 6 tests pass.

### 2d — `use-fetch-book-list.test.tsx`

- [ ] **Step 7: Write the test file**

```tsx
// client/src/provider/book/hook/use-fetch-book-list.test.tsx
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList } from '../type';

import { useFetchBookList } from './use-fetch-book-list';

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Title', author: 'Author', fileAs: '', publisher: '',
    series: '', seriesIndex: 0, subjects: [], identifiers: [],
    hasCover: false, size: 0, addedAt: '2024-01-01', ...overrides,
  };
}

function makeWrapper({
  initialBooks = {} as BookList,
  bookListLoading = false,
  completeBookIds = new Set<string>(),
  onSetBookList = (_next: BookList) => {},
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
      <Context.Provider value={{
        bookList, bookListFetched: false, bookListLoading: loading,
        bookListError: undefined, loadingByBookId: {}, errorByBookId: {},
        completeBookIds, setBookList,
        setBookListFetched: onSetBookListFetched,
        setBookListLoading: (v) => setLoading(v),
        setBookListError: onSetBookListError,
        setLoadingForBook: () => {}, setErrorForBook: () => {},
        setBookComplete: () => {}, clearCompleteBookIds: () => {},
      }}>
        {children}
      </Context.Provider>
    );
  };
}

describe('useFetchBookList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches GET /api/books', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    const { result } = renderHook(() => useFetchBookList(), { wrapper: makeWrapper() });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith('/api/books');
  });

  it('sets bookListFetched to true on success', async () => {
    const onSetBookListFetched = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ onSetBookListFetched }),
    });
    await act(() => result.current());
    expect(onSetBookListFetched).toHaveBeenCalledWith(true);
  });

  it('populates context with fetched books', async () => {
    const books = [makeBook({ id: '1', title: 'Dune' })];
    const onSetBookList = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(books) }));
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([serverBook]) }));
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ initialBooks: { '1': existing }, completeBookIds: new Set(['1']), onSetBookList }),
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
```

- [ ] **Step 8: Run**

```bash
cd client && npx vitest run src/provider/book/hook/use-fetch-book-list.test.tsx
```

Expected: 6 tests pass.

- [ ] **Step 9: Commit**

```bash
git add client/src/provider/book/hook/use-series-list.test.ts \
        client/src/provider/book/hook/use-standalone-book-list.test.ts \
        client/src/provider/book/hook/use-book-list.test.tsx \
        client/src/provider/book/hook/use-fetch-book-list.test.tsx
git commit -m "test: add tests for book read hooks"
```

---

## Task 3: Group 3 — book mutation hooks

**Files:**
- Create: `client/src/provider/book/hook/use-delete-book.test.tsx`
- Create: `client/src/provider/book/hook/use-patch-book-metadata.test.tsx`

### 3a — `use-delete-book.test.tsx`

The hook does an optimistic removal before the fetch, and rolls back on error. To observe context state, render `useContext(BookContext)` alongside the hook in the same `renderHook` call.

- [ ] **Step 1: Write the test file**

```tsx
// client/src/provider/book/hook/use-delete-book.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList } from '../type';

import { useDeleteBook } from './use-delete-book';

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Dune', author: 'Herbert', fileAs: '', publisher: '',
    series: '', seriesIndex: 0, subjects: [], identifiers: [],
    hasCover: false, size: 0, addedAt: '2024-01-01', ...overrides,
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
      <Context.Provider value={{
        bookList, bookListFetched: true, bookListLoading: false, bookListError: undefined,
        loadingByBookId: {}, errorByBookId: {}, completeBookIds: new Set(),
        setBookList, setBookListFetched: () => {}, setBookListLoading: () => {},
        setBookListError: () => {}, setLoadingForBook: () => {}, setErrorForBook: () => {},
        setBookComplete: () => {}, clearCompleteBookIds,
      }}>
        {children}
      </Context.Provider>
    );
  };
}

describe('useDeleteBook', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('optimistically removes the book from context before fetch resolves', async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((r) => { resolve = r; })));
    const book = makeBook({ id: '1' });
    const { result } = renderHook(
      () => ({ hook: useDeleteBook(), ctx: useContext(Context) }),
      { wrapper: makeWrapper([book]) }
    );
    act(() => { void result.current.hook[0]('1'); });
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
    expect(fetch).toHaveBeenCalledWith(
      `/api/books/${encodeURIComponent('book/1')}`,
      { method: 'DELETE' }
    );
  });

  it('book stays removed on 204 success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const book = makeBook({ id: '1' });
    const { result } = renderHook(
      () => ({ hook: useDeleteBook(), ctx: useContext(Context) }),
      { wrapper: makeWrapper([book]) }
    );
    await act(() => result.current.hook[0]('1'));
    expect(result.current.ctx.bookList['1']).toBeUndefined();
    expect(result.current.hook[2]).toBe(false);
  });

  it('rolls back and sets error on non-204 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500 }));
    const book = makeBook({ id: '1' });
    const { result } = renderHook(
      () => ({ hook: useDeleteBook(), ctx: useContext(Context) }),
      { wrapper: makeWrapper([book]) }
    );
    await act(() => result.current.hook[0]('1'));
    expect(result.current.ctx.bookList['1']).toEqual(book);
    expect(result.current.hook[2]).toBe(true);
  });

  it('rolls back, sets error and errorMessage when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const book = makeBook({ id: '1' });
    const { result } = renderHook(
      () => ({ hook: useDeleteBook(), ctx: useContext(Context) }),
      { wrapper: makeWrapper([book]) }
    );
    await act(() => result.current.hook[0]('1'));
    expect(result.current.ctx.bookList['1']).toEqual(book);
    expect(result.current.hook[2]).toBe(true);
    expect(result.current.hook[3]).toBe('Network error');
  });

  it('sets loading true during request and resets it after', async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((r) => { resolve = r; })));
    const { result } = renderHook(() => useDeleteBook(), {
      wrapper: makeWrapper([makeBook({ id: '1' })]),
    });
    act(() => { void result.current[0]('1'); });
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
});
```

- [ ] **Step 2: Run**

```bash
cd client && npx vitest run src/provider/book/hook/use-delete-book.test.tsx
```

Expected: 6 tests pass.

### 3b — `use-patch-book-metadata.test.tsx`

The hook builds FormData and PATCHes the book. Inspect the FormData from `vi.mocked(fetch).mock.calls[0][1].body` to verify field serialisation. To observe the context update, render `useContext(Context)` alongside the hook.

- [ ] **Step 3: Write the test file**

```tsx
// client/src/provider/book/hook/use-patch-book-metadata.test.tsx
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList } from '../type';

import { usePatchBookMetadata } from './use-patch-book-metadata';

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Dune', author: 'Herbert', fileAs: '', publisher: '',
    series: '', seriesIndex: 0, subjects: [], identifiers: [],
    hasCover: false, size: 0, addedAt: '2024-01-01', ...overrides,
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
      <Context.Provider value={{
        bookList, bookListFetched: true, bookListLoading: false, bookListError: undefined,
        loadingByBookId: {}, errorByBookId: {}, completeBookIds: new Set(),
        setBookList, setBookListFetched: () => {}, setBookListLoading: () => {},
        setBookListError: () => {}, setLoadingForBook: () => {}, setErrorForBook: () => {},
        setBookComplete: () => {}, clearCompleteBookIds: () => {},
      }}>
        {children}
      </Context.Provider>
    );
  };
}

describe('usePatchBookMetadata', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls PATCH /api/books/:id/metadata', async () => {
    const updated = makeBook({ id: '1', title: 'New Dune' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) }));
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) }));
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) }));
    const { result } = renderHook(() => usePatchBookMetadata(), {
      wrapper: makeWrapper([makeBook({ id: '1' })]),
    });
    await act(() => result.current[0]('1', {
      subjects: ['fiction', 'sci-fi'],
      identifiers: [{ scheme: 'isbn', value: '123' }],
    }));
    const body = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as FormData;
    expect(JSON.parse(body.get('subjects') as string)).toEqual(['fiction', 'sci-fi']);
    expect(JSON.parse(body.get('identifiers') as string)).toEqual([{ scheme: 'isbn', value: '123' }]);
  });

  it('updates context with the returned book on success', async () => {
    const updated = makeBook({ id: '1', title: 'Updated' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) }));
    const { result } = renderHook(
      () => ({ hook: usePatchBookMetadata(), ctx: useContext(Context) }),
      { wrapper: makeWrapper([makeBook({ id: '1' })]) }
    );
    await act(() => result.current.hook[0]('1', { title: 'Updated' }));
    expect(result.current.ctx.bookList['1'].title).toBe('Updated');
  });

  it('removes old key when returned book has a different id', async () => {
    const updated = makeBook({ id: '2', title: 'Renamed' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) }));
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(updated) }));
    const { result } = renderHook(() => usePatchBookMetadata(), {
      wrapper: makeWrapper([makeBook({ id: '1' })]),
    });
    const id = await act(() => result.current[0]('1', {}));
    expect(id).toBe('2');
  });

  it('sets error with body.error message on failed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Validation failed' }),
    }));
    const { result } = renderHook(() => usePatchBookMetadata(), {
      wrapper: makeWrapper([makeBook({ id: '1' })]),
    });
    await act(() => result.current[0]('1', {}));
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Validation failed');
  });

  it('falls back to "Save failed" when error response has no body.error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));
    const { result } = renderHook(() => usePatchBookMetadata(), {
      wrapper: makeWrapper([makeBook({ id: '1' })]),
    });
    await act(() => result.current[0]('1', {}));
    expect(result.current[3]).toBe('Save failed');
  });
});
```

- [ ] **Step 4: Run**

```bash
cd client && npx vitest run src/provider/book/hook/use-patch-book-metadata.test.tsx
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/provider/book/hook/use-delete-book.test.tsx \
        client/src/provider/book/hook/use-patch-book-metadata.test.tsx
git commit -m "test: add tests for book mutation hooks"
```

---

## Task 4: Group 4 — UI controls and components

**Files:**
- Create: `client/src/control/switch/index.test.tsx`
- Create: `client/src/component/collapsible-section/index.test.tsx`
- Create: `client/src/component/progress-indicator/index.test.tsx`
- Create: `client/src/component/chapter-progress/index.test.tsx`
- Create: `client/src/control/number-input/index.test.tsx`
- Create: `client/src/control/confirm-modal/index.test.tsx`
- Create: `client/src/control/proportional-chapter-slider/index.test.tsx`

All UI tests use `renderWithProviders` from `~/test-utils` and `userEvent` from `@testing-library/user-event`.

### 4a — `control/switch/index.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
// client/src/control/switch/index.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { Switch } from './index';

describe('Switch', () => {
  it('renders with role="switch" and correct aria-checked', () => {
    renderWithProviders(
      <Switch name="dark-mode" checked={true} onChange={vi.fn()} />
    );
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange with the toggled value when clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<Switch name="dark-mode" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange when Enter is pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<Switch name="dark-mode" checked={false} onChange={onChange} />);
    screen.getByRole('switch').focus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange when Space is pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<Switch name="dark-mode" checked={false} onChange={onChange} />);
    screen.getByRole('switch').focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not call onChange when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<Switch name="dark-mode" checked={false} disabled onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders the label text when provided', () => {
    renderWithProviders(
      <Switch name="dark-mode" checked={false} label="Dark mode" onChange={vi.fn()} />
    );
    expect(screen.getByText('Dark mode')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run**

```bash
cd client && npx vitest run src/control/switch/index.test.tsx
```

Expected: 6 tests pass.

### 4b — `component/collapsible-section/index.test.tsx`

- [ ] **Step 3: Write the test file**

```tsx
// client/src/component/collapsible-section/index.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { CollapsibleSection } from './index';

describe('CollapsibleSection', () => {
  it('hides children by default (uncontrolled)', () => {
    renderWithProviders(
      <CollapsibleSection title="Details">
        <span>Hidden content</span>
      </CollapsibleSection>
    );
    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
  });

  it('shows children after clicking the header', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CollapsibleSection title="Details">
        <span>Visible content</span>
      </CollapsibleSection>
    );
    await user.click(screen.getByRole('button', { name: /Details/ }));
    expect(screen.getByText('Visible content')).toBeInTheDocument();
  });

  it('toggles back to hidden on second click', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CollapsibleSection title="Details">
        <span>Content</span>
      </CollapsibleSection>
    );
    await user.click(screen.getByRole('button', { name: /Details/ }));
    await user.click(screen.getByRole('button', { name: /Details/ }));
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('calls onOpenToggle when the header is clicked', async () => {
    const user = userEvent.setup();
    const onOpenToggle = vi.fn();
    renderWithProviders(
      <CollapsibleSection title="Details" onOpenToggle={onOpenToggle}>
        <span>Content</span>
      </CollapsibleSection>
    );
    await user.click(screen.getByRole('button', { name: /Details/ }));
    expect(onOpenToggle).toHaveBeenCalledOnce();
  });

  it('opens and closes with Enter key', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CollapsibleSection title="Details">
        <span>Content</span>
      </CollapsibleSection>
    );
    const header = screen.getByRole('button', { name: /Details/ });
    header.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Content')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('respects controlled open={false} — keeps children hidden even after click', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CollapsibleSection title="Details" open={false} onOpenToggle={vi.fn()}>
        <span>Content</span>
      </CollapsibleSection>
    );
    await user.click(screen.getByRole('button', { name: /Details/ }));
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('renders subTitle when provided', () => {
    renderWithProviders(
      <CollapsibleSection title="Books" subTitle="3 items">
        <span>Content</span>
      </CollapsibleSection>
    );
    expect(screen.getByText('3 items')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run**

```bash
cd client && npx vitest run src/component/collapsible-section/index.test.tsx
```

Expected: 7 tests pass.

### 4c — `component/progress-indicator/index.test.tsx`

- [ ] **Step 5: Write the test file**

```tsx
// client/src/component/progress-indicator/index.test.tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ProgressIndicator } from './index';

describe('ProgressIndicator', () => {
  it('renders "Not started" when value is 0', () => {
    renderWithProviders(<ProgressIndicator value={0} />);
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('renders "Completed" when value is 1', () => {
    renderWithProviders(<ProgressIndicator value={1} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders a percentage string for mid-range values', () => {
    renderWithProviders(<ProgressIndicator value={0.5} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('does not render the SVG when value is 0', () => {
    const { container } = renderWithProviders(<ProgressIndicator value={0} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('does not render the SVG when value is 1', () => {
    const { container } = renderWithProviders(<ProgressIndicator value={1} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders the SVG for in-progress values', () => {
    const { container } = renderWithProviders(<ProgressIndicator value={0.5} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('clamps values below 0 to "Not started"', () => {
    renderWithProviders(<ProgressIndicator value={-0.5} />);
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('clamps values above 1 to "Completed"', () => {
    renderWithProviders(<ProgressIndicator value={1.5} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run**

```bash
cd client && npx vitest run src/component/progress-indicator/index.test.tsx
```

Expected: 8 tests pass.

### 4d — `component/chapter-progress/index.test.tsx`

- [ ] **Step 7: Write the test file**

```tsx
// client/src/component/chapter-progress/index.test.tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ChapterProgress } from './index';

describe('ChapterProgress', () => {
  it('renders "Ch {current} / {total}" when no chapter name is given', () => {
    renderWithProviders(<ChapterProgress current={3} total={10} />);
    expect(screen.getByText('Ch 3 / 10')).toBeInTheDocument();
  });

  it('renders "Ch {current}: {name} / {total}" when a name is given', () => {
    renderWithProviders(<ChapterProgress current={3} total={10} name="The Arrival" />);
    expect(screen.getByText('Ch 3: The Arrival / 10')).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run**

```bash
cd client && npx vitest run src/component/chapter-progress/index.test.tsx
```

Expected: 2 tests pass.

### 4e — `control/number-input/index.test.tsx`

- [ ] **Step 9: Write the test file**

```tsx
// client/src/control/number-input/index.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { NumberInput } from './index';

describe('NumberInput', () => {
  it('calls onChange with the parsed number when a valid value is typed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <NumberInput label="Series index" name="seriesIndex" value={undefined} onChange={onChange} />
    );
    await user.type(screen.getByRole('spinbutton', { hidden: true }) ?? screen.getByRole('textbox', { hidden: true }), '42');
    expect(onChange).toHaveBeenLastCalledWith(42);
  });

  it('calls onChange with undefined when the field is cleared', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <NumberInput label="Series index" name="seriesIndex" value={5} onChange={onChange} />
    );
    await user.clear(screen.getByDisplayValue('5'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('calls onValidChange(name, false) when an invalid string is entered', async () => {
    const user = userEvent.setup();
    const onValidChange = vi.fn();
    renderWithProviders(
      <NumberInput label="Index" name="idx" value={undefined} onValidChange={onValidChange} />
    );
    const input = screen.getByRole('textbox', { hidden: true }) ?? document.querySelector('input[name="idx"]')!;
    await user.type(input as HTMLElement, 'abc');
    expect(onValidChange).toHaveBeenCalledWith('idx', false);
  });

  it('calls onValidChange(name, true) when the field recovers from invalid', async () => {
    const user = userEvent.setup();
    const onValidChange = vi.fn();
    renderWithProviders(
      <NumberInput label="Index" name="idx" value={undefined} onValidChange={onValidChange} />
    );
    const input = document.querySelector('input[name="idx"]') as HTMLElement;
    await user.type(input, 'abc');
    await user.clear(input);
    await user.type(input, '5');
    expect(onValidChange).toHaveBeenCalledWith('idx', true);
  });

  it('displays the updated value when the external value prop changes', () => {
    const { rerender } = renderWithProviders(
      <NumberInput label="Index" name="idx" value={1} />
    );
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();
    rerender(
      <NumberInput label="Index" name="idx" value={99} />
    );
    expect(screen.getByDisplayValue('99')).toBeInTheDocument();
  });
});
```

**Note on the input selector:** `NumberInput` renders a plain `<input>` with no explicit type, so the accessible role may be "textbox" or require querying by `name` attribute. If the assertions about role fail, use `document.querySelector('input[name="idx"]')` as shown in the fallback above.

- [ ] **Step 10: Run**

```bash
cd client && npx vitest run src/control/number-input/index.test.tsx
```

Expected: 5 tests pass.

### 4f — `control/confirm-modal/index.test.tsx`

jsdom does not implement `HTMLDialogElement.prototype.showModal` or `.close`. They must be stubbed in `beforeAll`.

- [ ] **Step 11: Write the test file**

```tsx
// client/src/control/confirm-modal/index.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ConfirmModal } from './index';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

describe('ConfirmModal', () => {
  it('renders the title and children', () => {
    renderWithProviders(
      <ConfirmModal isOpen title="Delete book">
        <p>Are you sure?</p>
      </ConfirmModal>
    );
    expect(screen.getByText('Delete book')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('calls onConfirm when the confirm button is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithProviders(
      <ConfirmModal isOpen onConfirm={onConfirm} confirmText="Yes, delete" />
    );
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithProviders(
      <ConfirmModal isOpen onCancel={onCancel} cancelText="No, keep it" />
    );
    await user.click(screen.getByRole('button', { name: 'No, keep it' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('renders default button labels when no custom text is given', () => {
    renderWithProviders(<ConfirmModal isOpen />);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 12: Run**

```bash
cd client && npx vitest run src/control/confirm-modal/index.test.tsx
```

Expected: 4 tests pass.

### 4g — `control/proportional-chapter-slider/index.test.tsx`

The slider uses `ref.current.getBoundingClientRect()` and `setPointerCapture` — both unimplemented in jsdom and must be stubbed. Mock them on `Element.prototype` in `beforeAll`, then mock `getBoundingClientRect` on the track element to return a 100 px-wide rect starting at x=0. This means `clientX / 100 * 100` = `clientX` as the percentage, making arithmetic straightforward.

The slider's root `<div>` (the one with the pointer handlers) is the first child `div` inside the outermost `<div>`. The track `<div>` (attached to `trackRef`) is the first child of that root div.

- [ ] **Step 13: Write the test file**

```tsx
// client/src/control/proportional-chapter-slider/index.test.tsx
import { fireEvent } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ProportionalChapterSlider } from './index';

beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

function renderSlider(props: {
  value: number;
  chapterCount: number;
  chapterSpineMap?: number[];
  onChange?: (v: number) => void;
  onDragChange?: (d: boolean) => void;
  disabled?: boolean;
}) {
  const onChange = props.onChange ?? vi.fn();
  const { container } = renderWithProviders(
    <ProportionalChapterSlider
      value={props.value}
      onChange={onChange}
      chapterCount={props.chapterCount}
      chapterSpineMap={props.chapterSpineMap ?? []}
      disabled={props.disabled}
      onDragChange={props.onDragChange}
    />
  );
  // The slider root div (has pointer handlers) is the first child div of the wrapper
  const sliderRoot = container.firstElementChild!.firstElementChild as HTMLElement;
  // The track div (attached to trackRef) is the first child of sliderRoot
  const track = sliderRoot.firstElementChild as HTMLElement;
  // Mock getBoundingClientRect so clientX maps directly to percentage
  Object.defineProperty(track, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, width: 100 } as DOMRect),
  });
  return { container, sliderRoot, track, onChange };
}

describe('ProportionalChapterSlider', () => {
  it('renders "Not started" and "Finished" labels', () => {
    const { container } = renderWithProviders(
      <ProportionalChapterSlider value={0} onChange={vi.fn()} chapterCount={3} chapterSpineMap={[]} />
    );
    expect(container.textContent).toContain('Not started');
    expect(container.textContent).toContain('Finished');
  });

  it('renders tick marks for chapters 1 to (chapterCount-1)', () => {
    // 3 chapters → 2 ticks (at chapters 1 and 2)
    const { container } = renderWithProviders(
      <ProportionalChapterSlider value={0} onChange={vi.fn()} chapterCount={3} chapterSpineMap={[]} />
    );
    const sliderRoot = container.firstElementChild!.firstElementChild as HTMLElement;
    // Ticks are divs after fill and track divs; count by checking style.left
    const ticksWithLeft = Array.from(sliderRoot.children).filter(
      (el) => (el as HTMLElement).style.left && !(el as HTMLElement).style.width
    );
    expect(ticksWithLeft).toHaveLength(2);
  });

  it('calls onChange with the nearest chapter on pointer-up', () => {
    const onChange = vi.fn();
    const { sliderRoot } = renderSlider({ value: 0, chapterCount: 3, onChange });
    // At clientX=60 and a 100px track: pct=60 → nearestChapter(60, [], 3)
    // Chapter 1 at 33.33%, Chapter 2 at 66.67% → nearest to 60 is chapter 2
    fireEvent.pointerDown(sliderRoot, { clientX: 60, pointerId: 1 });
    fireEvent.pointerUp(sliderRoot, { clientX: 60, pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('does not fire onDragChange when disabled', () => {
    const onDragChange = vi.fn();
    const { sliderRoot } = renderSlider({ value: 0, chapterCount: 3, onDragChange, disabled: true });
    fireEvent.pointerDown(sliderRoot, { clientX: 50, pointerId: 1 });
    expect(onDragChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 14: Run**

```bash
cd client && npx vitest run src/control/proportional-chapter-slider/index.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 15: Commit**

```bash
git add client/src/control/switch/index.test.tsx \
        client/src/component/collapsible-section/index.test.tsx \
        client/src/component/progress-indicator/index.test.tsx \
        client/src/component/chapter-progress/index.test.tsx \
        client/src/control/number-input/index.test.tsx \
        client/src/control/confirm-modal/index.test.tsx \
        client/src/control/proportional-chapter-slider/index.test.tsx
git commit -m "test: add tests for UI controls and components"
```

---

## Final verification

After all four groups complete:

- [ ] **Run the full test suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass with no failures.

---

## Self-review notes

- **Spec coverage:** All sections covered — triage (delete + repair), Group 1 (4 files), Group 2 (4 files), Group 3 (2 files), Group 4 (7 files).
- **No placeholders:** All steps contain actual test code and exact commands.
- **Type consistency:** `makeBook` factory used consistently; context shapes match the `BookContext` type from `context.ts`; mock patterns (`vi.mock` + `await import`) match existing tests like `use-my-progress.test.ts`.
- **jsdom limitations addressed:** `showModal`/`close` stubbed for `ConfirmModal`; `setPointerCapture`/`getBoundingClientRect` stubbed for `ProportionalChapterSlider`; `window.location` replaced for `useLogout`.
- **NumberInput selector note included** — the input has no explicit type attribute so the accessible role query may need fallback to `document.querySelector`.

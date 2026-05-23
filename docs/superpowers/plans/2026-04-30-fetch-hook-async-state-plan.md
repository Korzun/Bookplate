# Fetch Hook Async State Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift `loading/error` state out of fetch hooks and into provider context so concurrent hook calls for different resources don't race and there are no implicit "don't call from multiple components" constraints.

**Architecture:** Each provider context grows to hold async state alongside data. For parameterized resources (progress by username, books by bookId) the state is stored as `Record<string, boolean>` / `Record<string, string | undefined>`. All context writes use functional updaters to prevent stale-closure overwrites. Fetch hooks drop local `useState` and write directly to context; they return just the fetch function. Data hooks read `loading/error` from context instead of threading it from fetch hooks.

**Tech Stack:** React 18, TypeScript, Vitest, `@testing-library/react`

**Spec:** `docs/superpowers/specs/2026-04-30-fetch-hook-async-state-design.md`

---

## File Map

**Modified:**
- `client/src/provider/progress/context.ts`
- `client/src/provider/progress/provider.tsx`
- `client/src/provider/progress/hook/use-fetch-user-progress-list.ts`
- `client/src/provider/progress/hook/use-fetch-my-progress-list.ts`
- `client/src/provider/progress/hook/use-user-progress-list.ts`
- `client/src/provider/progress/hook/use-my-progress-list.ts`
- `client/src/provider/progress/hook/use-delete-user-progress.ts`
- `client/src/provider/user/context.ts`
- `client/src/provider/user/provider.tsx`
- `client/src/provider/user/hook/use-user-list.ts`
- `client/src/provider/user/hook/use-delete-user.ts`
- `client/src/provider/user/hook/use-register-user.ts`
- `client/src/provider/book/context.ts`
- `client/src/provider/book/provider.tsx`
- `client/src/provider/book/hook/use-fetch-book-list.ts`
- `client/src/provider/book/hook/use-fetch-book.ts`
- `client/src/provider/book/hook/use-book-list.ts`
- `client/src/provider/book/hook/use-book.ts`
- `client/src/provider/book/hook/use-scan-library.ts`
- `client/src/provider/book/hook/use-upload-book-list.ts`
- `client/src/provider/book/hook/use-patch-book-metadata.ts`
- `client/src/provider/book/hook/use-delete-book.ts`
- `client/src/provider/user/hook/use-user-list.test.tsx`
- `client/src/provider/user/hook/use-delete-user.test.tsx`
- `client/src/provider/user/hook/use-register-user.test.tsx`

**Created:**
- `client/src/provider/progress/hook/use-user-progress-list.test.tsx`

**Test commands** (run from `client/` directory):
- All tests: `npm test`
- Specific file: `npm test -- src/provider/progress/hook/use-user-progress-list.test.tsx`

---

## Task 1: Update ProgressContext and ProgressProvider

**Files:**
- Modify: `client/src/provider/progress/context.ts`
- Modify: `client/src/provider/progress/provider.tsx`

- [ ] **Step 1: Replace ProgressContext type**

Replace the entire contents of `client/src/provider/progress/context.ts`:

```ts
import { createContext } from 'react';

import type { ProgressList, UserProgressList } from './type';

export type ProgressContext = {
  progressList: ProgressList;
  loadingByUsername: Record<string, boolean>;
  errorByUsername: Record<string, string | undefined>;
  setProgressForUsername: (username: string, data: UserProgressList) => void;
  setLoadingForUsername: (username: string, loading: boolean) => void;
  setErrorForUsername: (username: string, error: string | undefined) => void;
};

export const Context = createContext<ProgressContext>({
  progressList: {},
  loadingByUsername: {},
  errorByUsername: {},
  setProgressForUsername: () => {},
  setLoadingForUsername: () => {},
  setErrorForUsername: () => {},
});
```

- [ ] **Step 2: Replace ProgressProvider**

Replace the entire contents of `client/src/provider/progress/provider.tsx`:

```tsx
import { useCallback, useState, type ReactNode } from 'react';

import { Context } from './context';
import type { ProgressList, UserProgressList } from './type';

export type ProgressProviderProps = { children: ReactNode };
export const ProgressProvider = ({ children }: ProgressProviderProps) => {
  const [progressList, setProgressListRaw] = useState<ProgressList>({});
  const [loadingByUsername, setLoadingByUsernameRaw] = useState<Record<string, boolean>>({});
  const [errorByUsername, setErrorByUsernameRaw] = useState<Record<string, string | undefined>>({});

  const setProgressForUsername = useCallback((username: string, data: UserProgressList) => {
    setProgressListRaw(prev => ({ ...prev, [username]: data }));
  }, []);

  const setLoadingForUsername = useCallback((username: string, loading: boolean) => {
    setLoadingByUsernameRaw(prev => ({ ...prev, [username]: loading }));
  }, []);

  const setErrorForUsername = useCallback((username: string, error: string | undefined) => {
    setErrorByUsernameRaw(prev => ({ ...prev, [username]: error }));
  }, []);

  return (
    <Context.Provider value={{
      progressList,
      loadingByUsername,
      errorByUsername,
      setProgressForUsername,
      setLoadingForUsername,
      setErrorForUsername,
    }}>
      {children}
    </Context.Provider>
  );
};
```

- [ ] **Step 3: Run the full test suite to confirm nothing is broken yet**

```bash
npm test
```

TypeScript errors are expected (consuming hooks still reference removed `setProgressList`). Runtime test failures are not expected yet — no hook implementations have changed.

- [ ] **Step 4: Commit**

```bash
git add client/src/provider/progress/context.ts client/src/provider/progress/provider.tsx
git commit -m "refactor: add keyed async state to ProgressContext"
```

---

## Task 2: Rewrite useFetchUserProgressList

**Files:**
- Modify: `client/src/provider/progress/hook/use-fetch-user-progress-list.ts`

- [ ] **Step 1: Replace the hook**

Replace the entire contents of `client/src/provider/progress/hook/use-fetch-user-progress-list.ts`:

```ts
import { useCallback, useContext } from 'react';

import { Context } from '../context';
import type { Progress, UserProgressList } from '../type';

export type FetchUserProgressList = (username: string) => Promise<void>;

export const useFetchUserProgressList = (): FetchUserProgressList => {
  const {
    loadingByUsername,
    setLoadingForUsername,
    setErrorForUsername,
    setProgressForUsername,
  } = useContext(Context);

  return useCallback(async (username: string) => {
    if (loadingByUsername[username]) return;

    setLoadingForUsername(username, true);
    setErrorForUsername(username, undefined);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(username)}/progress`);
      if (!response.ok) throw new Error('Failed to fetch progress');
      const data = await (response.json() as Promise<Progress[]>);
      setProgressForUsername(
        username,
        data.reduce((acc, p) => ({ ...acc, [p.document]: p }), {} as UserProgressList),
      );
    } catch (err) {
      setErrorForUsername(username, err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingForUsername(username, false);
    }
  }, [loadingByUsername, setLoadingForUsername, setErrorForUsername, setProgressForUsername]);
};
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

TypeScript errors on `useUserProgressList` and `useMyProgressList` are expected (they still destructure the old tuple return). Fix in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add client/src/provider/progress/hook/use-fetch-user-progress-list.ts
git commit -m "refactor: useFetchUserProgressList writes async state to context"
```

---

## Task 3: Rewrite useFetchMyProgressList

**Files:**
- Modify: `client/src/provider/progress/hook/use-fetch-my-progress-list.ts`

- [ ] **Step 1: Replace the hook**

Replace the entire contents of `client/src/provider/progress/hook/use-fetch-my-progress-list.ts`:

```ts
import { useCallback, useContext } from 'react';

import { useUsername } from '../../../provider/auth';
import { Context } from '../context';
import type { Progress, UserProgressList } from '../type';

export type FetchMyProgressList = () => Promise<void>;

export const useFetchMyProgressList = (): FetchMyProgressList => {
  const {
    loadingByUsername,
    setLoadingForUsername,
    setErrorForUsername,
    setProgressForUsername,
  } = useContext(Context);
  const [username] = useUsername();

  return useCallback(async () => {
    if (username === undefined) return;
    if (loadingByUsername[username]) return;

    setLoadingForUsername(username, true);
    setErrorForUsername(username, undefined);
    try {
      const response = await fetch('/api/my/progress');
      if (!response.ok) throw new Error('Failed to fetch progress');
      const data = await (response.json() as Promise<Progress[]>);
      setProgressForUsername(
        username,
        data.reduce((acc, p) => ({ ...acc, [p.document]: p }), {} as UserProgressList),
      );
    } catch (err) {
      setErrorForUsername(username, err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingForUsername(username, false);
    }
  }, [username, loadingByUsername, setLoadingForUsername, setErrorForUsername, setProgressForUsername]);
};
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

- [ ] **Step 3: Commit**

```bash
git add client/src/provider/progress/hook/use-fetch-my-progress-list.ts
git commit -m "refactor: useFetchMyProgressList writes async state to context"
```

---

## Task 4: Rewrite useUserProgressList with tests

**Files:**
- Create: `client/src/provider/progress/hook/use-user-progress-list.test.tsx`
- Modify: `client/src/provider/progress/hook/use-user-progress-list.ts`

- [ ] **Step 1: Write the test file**

Create `client/src/provider/progress/hook/use-user-progress-list.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { ProgressList, UserProgressList } from '../type';

import { useUserProgressList } from './use-user-progress-list';

function makeWrapper(initialProgress: ProgressList = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [progressList, setProgressListRaw] = useState<ProgressList>(initialProgress);
    const [loadingByUsername, setLoadingByUsernameRaw] = useState<Record<string, boolean>>({});
    const [errorByUsername, setErrorByUsernameRaw] = useState<Record<string, string | undefined>>({});

    const setProgressForUsername = useCallback((username: string, data: UserProgressList) => {
      setProgressListRaw(prev => ({ ...prev, [username]: data }));
    }, []);
    const setLoadingForUsername = useCallback((username: string, loading: boolean) => {
      setLoadingByUsernameRaw(prev => ({ ...prev, [username]: loading }));
    }, []);
    const setErrorForUsername = useCallback((username: string, error: string | undefined) => {
      setErrorByUsernameRaw(prev => ({ ...prev, [username]: error }));
    }, []);

    return (
      <Context.Provider value={{
        progressList,
        loadingByUsername,
        errorByUsername,
        setProgressForUsername,
        setLoadingForUsername,
        setErrorForUsername,
      }}>
        {children}
      </Context.Provider>
    );
  };
}

describe('useUserProgressList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns undefined and false states when username is undefined', () => {
    const { result } = renderHook(() => useUserProgressList(undefined), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });

  it('returns data already in context without fetching', () => {
    const existingProgress: UserProgressList = { 'book-1': { document: 'book-1', percentage: 50 } };
    const { result } = renderHook(() => useUserProgressList('alice'), {
      wrapper: makeWrapper({ alice: existingProgress }),
    });
    expect(result.current[0]).toEqual(existingProgress);
    expect(result.current[1]).toBe(false);
    expect(result.current[2]).toBe(false);
  });

  it('triggers a fetch on mount when data is absent', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ document: 'book-1', percentage: 75 }]),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useUserProgressList('alice'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current[1]).toBe(false));
    expect(mockFetch).toHaveBeenCalledWith('/api/users/alice/progress');
    expect(result.current[0]).toEqual({ 'book-1': { document: 'book-1', percentage: 75 } });
  });

  it('shows loading state while fetch is in flight', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(
      new Promise(resolve => { resolveFetch = resolve; })
    ));

    const { result } = renderHook(() => useUserProgressList('alice'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current[1]).toBe(true));
    resolveFetch({ ok: true, json: () => Promise.resolve([]) });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  it('returns error state on failed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useUserProgressList('alice'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current[2]).toBe(true));
    expect(result.current[3]).toBe('Failed to fetch progress');
  });

  it('does not re-fetch if data is already in context', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const existingProgress: UserProgressList = { 'book-1': { document: 'book-1', percentage: 50 } };

    renderHook(() => useUserProgressList('alice'), {
      wrapper: makeWrapper({ alice: existingProgress }),
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('concurrent fetches for different usernames both persist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const username = decodeURIComponent((url as string).split('/')[3]);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ document: `book-${username}`, percentage: 50 }]),
      });
    }));

    const { result } = renderHook(
      () => ({
        alice: useUserProgressList('alice'),
        bob: useUserProgressList('bob'),
      }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.alice[1]).toBe(false);
      expect(result.current.bob[1]).toBe(false);
    });

    // Both datasets survive — this is the regression test for the stale-closure race
    expect(result.current.alice[0]).toEqual({ 'book-alice': { document: 'book-alice', percentage: 50 } });
    expect(result.current.bob[0]).toEqual({ 'book-bob': { document: 'book-bob', percentage: 50 } });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npm test -- src/provider/progress/hook/use-user-progress-list.test.tsx
```

Expected: most tests fail because `useUserProgressList` still references the old `useFetchUserProgressList` tuple return.

- [ ] **Step 3: Replace useUserProgressList**

Replace the entire contents of `client/src/provider/progress/hook/use-user-progress-list.ts`:

```ts
import { useContext, useEffect, useMemo } from 'react';

import { Context } from '../context';
import type { UserProgressList } from '../type';

import { useFetchUserProgressList } from './use-fetch-user-progress-list';

export type UseUserProgressList =
  | [undefined, false, false, undefined]
  | [UserProgressList, false, false, undefined]
  | [UserProgressList, true, false, undefined]
  | [undefined, true, false, undefined]
  | [undefined, false, true, undefined]
  | [undefined, false, true, string];

export const useUserProgressList = (username: string | undefined): UseUserProgressList => {
  const { progressList, loadingByUsername, errorByUsername } = useContext(Context);
  const fetchUserProgressList = useFetchUserProgressList();

  const loading = username !== undefined ? (loadingByUsername[username] ?? false) : false;
  const errorMessage = username !== undefined ? errorByUsername[username] : undefined;

  useEffect(() => {
    if (username === undefined) return;
    if (progressList[username] !== undefined) return;
    if (loadingByUsername[username]) return;
    if (errorByUsername[username] !== undefined) return;
    void fetchUserProgressList(username);
  }, [username, progressList, loadingByUsername, errorByUsername, fetchUserProgressList]);

  return useMemo((): UseUserProgressList => {
    if (username === undefined) return [undefined, false, false, undefined];
    if (errorMessage !== undefined) return [undefined, false, true, errorMessage];
    return [progressList[username], loading, false, undefined];
  }, [progressList, loading, errorMessage, username]);
};
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npm test -- src/provider/progress/hook/use-user-progress-list.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Run the full suite to catch regressions**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add client/src/provider/progress/hook/use-user-progress-list.test.tsx \
        client/src/provider/progress/hook/use-user-progress-list.ts
git commit -m "refactor: useUserProgressList reads async state from context"
```

---

## Task 5: Rewrite useMyProgressList

**Files:**
- Modify: `client/src/provider/progress/hook/use-my-progress-list.ts`

- [ ] **Step 1: Replace the hook**

Replace the entire contents of `client/src/provider/progress/hook/use-my-progress-list.ts`:

```ts
import { useContext, useEffect, useMemo } from 'react';

import { useUsername } from '../../../provider/auth';
import { Context } from '../context';
import type { UserProgressList } from '../type';

import { useFetchMyProgressList } from './use-fetch-my-progress-list';

export type UseMyProgressList =
  | [undefined, false, false, undefined]
  | [UserProgressList, false, false, undefined]
  | [UserProgressList, true, false, undefined]
  | [undefined, true, false, undefined]
  | [undefined, false, true, undefined]
  | [undefined, false, true, string];

export const useMyProgressList = (): UseMyProgressList => {
  const { progressList, loadingByUsername, errorByUsername } = useContext(Context);
  const [username] = useUsername();
  const fetchMyProgressList = useFetchMyProgressList();

  const loading = username !== undefined ? (loadingByUsername[username] ?? false) : false;
  const errorMessage = username !== undefined ? errorByUsername[username] : undefined;

  useEffect(() => {
    if (username === undefined) return;
    if (progressList[username] !== undefined) return;
    if (loadingByUsername[username]) return;
    if (errorByUsername[username] !== undefined) return;
    void fetchMyProgressList();
  }, [username, progressList, loadingByUsername, errorByUsername, fetchMyProgressList]);

  return useMemo((): UseMyProgressList => {
    if (username === undefined) return [undefined, false, true, 'User not logged in'];
    if (errorMessage !== undefined) return [undefined, false, true, errorMessage];
    return [progressList[username], loading, false, undefined];
  }, [progressList, loading, errorMessage, username]);
};
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/provider/progress/hook/use-my-progress-list.ts
git commit -m "refactor: useMyProgressList reads async state from context"
```

---

## Task 6: Adapt useDeleteUserProgress

`useDeleteUserProgress` is a mutation hook (local `loading/error` state stays unchanged) but it must switch from the removed `setProgressList(value)` to `setProgressForUsername(username, value)`.

**Files:**
- Modify: `client/src/provider/progress/hook/use-delete-user-progress.ts`

- [ ] **Step 1: Replace the hook**

Replace the entire contents of `client/src/provider/progress/hook/use-delete-user-progress.ts`:

```ts
import { useCallback, useContext, useMemo, useState } from 'react';

import { Context } from '../context';
import type { UserProgressList } from '../type';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const removeProgressById = (bookId: string, { [bookId]: _, ...rest }: UserProgressList) => rest;

export type DeleteUserProgress = (bookId: string) => Promise<void>;
export type UseDeleteUserProgress =
  | [DeleteUserProgress, false, false, undefined]
  | [DeleteUserProgress, true, false, undefined]
  | [DeleteUserProgress, false, true, undefined]
  | [DeleteUserProgress, false, true, string];

export const useDeleteUserProgress = (username?: string): UseDeleteUserProgress => {
  const { progressList, setProgressForUsername } = useContext(Context);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const deleteUserProgress = useCallback(async (bookId: string) => {
    if (deleting) return;

    if (username === undefined) {
      setError(true);
      setErrorMessage('Failed to delete progress');
      return;
    }

    const userProgressList = progressList[username];
    const progress = userProgressList?.[bookId];
    if (progress === undefined) {
      setError(true);
      setErrorMessage('Failed to delete progress');
      return;
    }

    setProgressForUsername(username, removeProgressById(bookId, userProgressList));

    try {
      setDeleting(true);
      setError(false);
      setErrorMessage(undefined);
      const response = await fetch(
        `/api/users/${encodeURIComponent(username)}/progress/${encodeURIComponent(bookId)}`,
        { method: 'DELETE' },
      );
      if (response.status !== 204) throw new Error('Failed to clear progress');
    } catch (err) {
      setError(true);
      setProgressForUsername(username, { ...userProgressList, [bookId]: progress });
      if (err instanceof Error) setErrorMessage(err.message);
    } finally {
      setDeleting(false);
    }
  }, [progressList, setProgressForUsername, username, deleting]);

  return useMemo(
    () => [deleteUserProgress, deleting, error, errorMessage] as UseDeleteUserProgress,
    [deleteUserProgress, deleting, error, errorMessage],
  );
};
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all tests pass, no TypeScript errors in the progress domain.

- [ ] **Step 3: Commit**

```bash
git add client/src/provider/progress/hook/use-delete-user-progress.ts
git commit -m "refactor: useDeleteUserProgress uses setProgressForUsername"
```

---

## Task 7: Update UserContext and UserProvider

**Files:**
- Modify: `client/src/provider/user/context.ts`
- Modify: `client/src/provider/user/provider.tsx`

- [ ] **Step 1: Replace UserContext type**

Replace the entire contents of `client/src/provider/user/context.ts`:

```ts
import { createContext } from 'react';

import { UserList } from './type';

export type UserContext = {
  userList: UserList;
  loading: boolean;
  error: string | undefined;
  setUserList: (updater: (prev: UserList) => UserList) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | undefined) => void;
};

export const Context = createContext<UserContext>({
  userList: {},
  loading: false,
  error: undefined,
  setUserList: () => {},
  setLoading: () => {},
  setError: () => {},
});
```

- [ ] **Step 2: Replace UserProvider**

Replace the entire contents of `client/src/provider/user/provider.tsx`:

```tsx
import { useCallback, useState, type ReactNode } from 'react';

import { Context } from './context';
import { UserList } from './type';

export type UserProviderProps = { children: ReactNode };
export const UserProvider = ({ children }: UserProviderProps) => {
  const [userList, setUserListRaw] = useState<UserList>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const setUserList = useCallback(
    (updater: (prev: UserList) => UserList) => setUserListRaw(updater),
    [],
  );

  return (
    <Context.Provider value={{ userList, loading, error, setUserList, setLoading, setError }}>
      {children}
    </Context.Provider>
  );
};
```

- [ ] **Step 3: Run tests to see which are now broken**

```bash
npm test
```

Expected: user hook tests fail — wrappers provide old context shape. Fix in next two tasks.

- [ ] **Step 4: Commit**

```bash
git add client/src/provider/user/context.ts client/src/provider/user/provider.tsx
git commit -m "refactor: add loading/error state to UserContext"
```

---

## Task 8: Rewrite useUserList and update its test wrapper

**Files:**
- Modify: `client/src/provider/user/hook/use-user-list.ts`
- Modify: `client/src/provider/user/hook/use-user-list.test.tsx`

- [ ] **Step 1: Replace useUserList**

Replace the entire contents of `client/src/provider/user/hook/use-user-list.ts`:

```ts
import { useCallback, useContext, useEffect, useMemo } from 'react';

import { Context } from '../context';
import type { User } from '../type';

export const sortUserList = (userA: User, userB: User) =>
  userA.username.localeCompare(userB.username);

export type UseUserList =
  | [User[], true, false, undefined]
  | [User[], false, false, undefined]
  | [User[], false, true, undefined]
  | [User[], false, true, string];

export const useUserList = (): UseUserList => {
  const { userList, loading, error, setUserList, setLoading, setError } = useContext(Context);

  const getUserList = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch('/api/users');
      const users = await (response.json() as Promise<User[]>);
      setUserList(() =>
        users.reduce(
          (record, user) => ({ ...record, [user.username]: user }),
          {} as Record<string, User>,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [setUserList, setLoading, setError]);

  useEffect(() => {
    if (!loading && error === undefined && Object.keys(userList).length === 0) {
      void getUserList();
    }
  }, [getUserList]);

  return useMemo(
    () =>
      [
        Object.values(userList).sort(sortUserList),
        loading,
        error !== undefined,
        error,
      ] as UseUserList,
    [userList, loading, error],
  );
};
```

- [ ] **Step 2: Update the test wrapper in use-user-list.test.tsx**

Replace the `makeWrapper` function (lines 11-18) in `client/src/provider/user/hook/use-user-list.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { User, UserList } from '../type';

import { useUserList } from '.';

function makeWrapper(initialUsers: User[] = []) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [userList, setUserListRaw] = useState<UserList>(
      Object.fromEntries(initialUsers.map((u) => [u.username, u])),
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const setUserList = useCallback(
      (updater: (prev: UserList) => UserList) => setUserListRaw(updater),
      [],
    );
    return (
      <Context.Provider value={{ userList, loading, error, setUserList, setLoading, setError }}>
        {children}
      </Context.Provider>
    );
  };
}

describe('useUserList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns empty list and default state initially', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) }));
    const { result } = renderHook(() => useUserList(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current[1]).toBe(false));
    const [userList, loading, error, errorMessage] = result.current;
    expect(userList).toEqual([]);
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('returns users from context in sorted order', () => {
    const users: User[] = [
      { username: 'zara', progressCount: 0 },
      { username: 'alice', progressCount: 1 },
    ];
    const { result } = renderHook(() => useUserList(), { wrapper: makeWrapper(users) });
    expect(result.current[0]).toEqual([
      { username: 'alice', progressCount: 1 },
      { username: 'zara', progressCount: 0 },
    ]);
  });

  it('fetches user list on mount', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', mockFetch);
    renderHook(() => useUserList(), { wrapper: makeWrapper() });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/users'));
  });
});
```

- [ ] **Step 3: Run the user-list tests**

```bash
npm test -- src/provider/user/hook/use-user-list.test.tsx
```

Expected: all pass.

- [ ] **Step 4: Run the full suite**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add client/src/provider/user/hook/use-user-list.ts \
        client/src/provider/user/hook/use-user-list.test.tsx
git commit -m "refactor: useUserList reads async state from context"
```

---

## Task 9: Update useDeleteUser and useRegisterUser for new setUserList signature

Both mutation hooks pass a value to `setUserList`. The new signature requires a functional updater.

**Files:**
- Modify: `client/src/provider/user/hook/use-delete-user.ts`
- Modify: `client/src/provider/user/hook/use-register-user.ts`
- Modify: `client/src/provider/user/hook/use-delete-user.test.tsx`
- Modify: `client/src/provider/user/hook/use-register-user.test.tsx`

- [ ] **Step 1: Update setUserList calls in use-delete-user.ts**

In `client/src/provider/user/hook/use-delete-user.ts`, make three changes:

Change the context destructure (currently reads `setUserList`):
```ts
const { userList, setUserList } = useContext(Context);
```
_(no change needed here — same names, new signature)_

Change the optimistic remove (currently line 28):
```ts
// Before:
setUserList(removeUserByUsername(username, userList));
// After:
setUserList(prev => removeUserByUsername(username, prev));
```

Change the rollback (currently line 43):
```ts
// Before:
setUserList({ ...userList, [username]: user });
// After:
setUserList(prev => ({ ...prev, [username]: user }));
```

- [ ] **Step 2: Update setUserList calls in use-register-user.ts**

In `client/src/provider/user/hook/use-register-user.ts`, make two changes:

Change the optimistic add (currently line 37):
```ts
// Before:
setUserList({ ...userList, [username]: { username, progressCount: 0 } });
// After:
setUserList(prev => ({ ...prev, [username]: { username, progressCount: 0 } }));
```

Change the rollback (currently line 55):
```ts
// Before:
setUserList(removeUserByUsername(username, userList));
// After:
setUserList(prev => removeUserByUsername(username, prev));
```

- [ ] **Step 3: Update test wrapper in use-delete-user.test.tsx**

Replace the `makeWrapper` function and imports at the top of `client/src/provider/user/hook/use-delete-user.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { User, UserList } from '../type';

import { useDeleteUser, useUserList } from '.';

function makeWrapper(initialUsers: User[] = []) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [userList, setUserListRaw] = useState<UserList>(
      Object.fromEntries(initialUsers.map((u) => [u.username, u])),
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const setUserList = useCallback(
      (updater: (prev: UserList) => UserList) => setUserListRaw(updater),
      [],
    );
    return (
      <Context.Provider value={{ userList, loading, error, setUserList, setLoading, setError }}>
        {children}
      </Context.Provider>
    );
  };
}
```

Leave all test cases (`describe`/`it` blocks) unchanged.

- [ ] **Step 4: Update test wrapper in use-register-user.test.tsx**

Replace the `makeWrapper` function and imports at the top of `client/src/provider/user/hook/use-register-user.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { User, UserList } from '../type';

import { useRegisterUser, useUserList } from '.';

function makeWrapper(initialUsers: User[] = []) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [userList, setUserListRaw] = useState<UserList>(
      Object.fromEntries(initialUsers.map((u) => [u.username, u])),
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const setUserList = useCallback(
      (updater: (prev: UserList) => UserList) => setUserListRaw(updater),
      [],
    );
    return (
      <Context.Provider value={{ userList, loading, error, setUserList, setLoading, setError }}>
        {children}
      </Context.Provider>
    );
  };
}
```

Leave all test cases unchanged.

- [ ] **Step 5: Run all user hook tests**

```bash
npm test -- src/provider/user/hook
```

Expected: all pass.

- [ ] **Step 6: Run the full suite**

```bash
npm test
```

- [ ] **Step 7: Commit**

```bash
git add client/src/provider/user/hook/use-delete-user.ts \
        client/src/provider/user/hook/use-register-user.ts \
        client/src/provider/user/hook/use-delete-user.test.tsx \
        client/src/provider/user/hook/use-register-user.test.tsx
git commit -m "refactor: update user mutation hooks for functional setUserList"
```

---

## Task 10: Update BookContext and BookProvider

**Files:**
- Modify: `client/src/provider/book/context.ts`
- Modify: `client/src/provider/book/provider.tsx`

- [ ] **Step 1: Replace BookContext type**

Replace the entire contents of `client/src/provider/book/context.ts`:

```ts
import { createContext } from 'react';

import type { BookList } from './type';

export type BookContext = {
  bookList: BookList;
  bookListLoading: boolean;
  bookListError: string | undefined;
  loadingByBookId: Record<string, boolean>;
  errorByBookId: Record<string, string | undefined>;
  setBookList: (updater: (prev: BookList) => BookList) => void;
  setBookListLoading: (loading: boolean) => void;
  setBookListError: (error: string | undefined) => void;
  setLoadingForBook: (bookId: string, loading: boolean) => void;
  setErrorForBook: (bookId: string, error: string | undefined) => void;
};

export const Context = createContext<BookContext>({
  bookList: {},
  bookListLoading: false,
  bookListError: undefined,
  loadingByBookId: {},
  errorByBookId: {},
  setBookList: () => {},
  setBookListLoading: () => {},
  setBookListError: () => {},
  setLoadingForBook: () => {},
  setErrorForBook: () => {},
});
```

- [ ] **Step 2: Replace BookProvider**

Replace the entire contents of `client/src/provider/book/provider.tsx`:

```tsx
import { useCallback, useState, type ReactNode } from 'react';

import { Context } from './context';
import type { BookList } from './type';

export type BookProviderProps = { children: ReactNode };
export const BookProvider = ({ children }: BookProviderProps) => {
  const [bookList, setBookListRaw] = useState<BookList>({});
  const [bookListLoading, setBookListLoading] = useState(false);
  const [bookListError, setBookListError] = useState<string | undefined>();
  const [loadingByBookId, setLoadingByBookIdRaw] = useState<Record<string, boolean>>({});
  const [errorByBookId, setErrorByBookIdRaw] = useState<Record<string, string | undefined>>({});

  const setBookList = useCallback(
    (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
    [],
  );

  const setLoadingForBook = useCallback((bookId: string, loading: boolean) => {
    setLoadingByBookIdRaw(prev => ({ ...prev, [bookId]: loading }));
  }, []);

  const setErrorForBook = useCallback((bookId: string, error: string | undefined) => {
    setErrorByBookIdRaw(prev => ({ ...prev, [bookId]: error }));
  }, []);

  return (
    <Context.Provider value={{
      bookList,
      bookListLoading,
      bookListError,
      loadingByBookId,
      errorByBookId,
      setBookList,
      setBookListLoading,
      setBookListError,
      setLoadingForBook,
      setErrorForBook,
    }}>
      {children}
    </Context.Provider>
  );
};
```

- [ ] **Step 3: Run tests — TypeScript errors expected in book hooks**

```bash
npm test
```

- [ ] **Step 4: Commit**

```bash
git add client/src/provider/book/context.ts client/src/provider/book/provider.tsx
git commit -m "refactor: add async state to BookContext"
```

---

## Task 11: Rewrite useFetchBookList and useFetchBook

**Files:**
- Modify: `client/src/provider/book/hook/use-fetch-book-list.ts`
- Modify: `client/src/provider/book/hook/use-fetch-book.ts`

- [ ] **Step 1: Replace useFetchBookList**

Replace the entire contents of `client/src/provider/book/hook/use-fetch-book-list.ts`:

```ts
import { useCallback, useContext } from 'react';

import { Context } from '../context';
import type { Book, BookList } from '../type';

export type FetchBookList = () => Promise<void>;

export const useFetchBookList = (): FetchBookList => {
  const { bookListLoading, setBookList, setBookListLoading, setBookListError } = useContext(Context);

  return useCallback(async () => {
    if (bookListLoading) return;

    setBookListLoading(true);
    setBookListError(undefined);
    try {
      const response = await fetch('/api/books');
      if (!response.ok) throw new Error('Failed to fetch books');
      const bookListArray = await (response.json() as Promise<Book[]>);
      setBookList(() =>
        bookListArray.reduce((acc, book) => ({ ...acc, [book.id]: book }), {} as BookList),
      );
    } catch (err) {
      setBookListError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBookListLoading(false);
    }
  }, [bookListLoading, setBookList, setBookListLoading, setBookListError]);
};
```

- [ ] **Step 2: Replace useFetchBook**

Replace the entire contents of `client/src/provider/book/hook/use-fetch-book.ts`:

```ts
import { useCallback, useContext } from 'react';

import { Context } from '../context';
import type { Book } from '../type';

export type FetchBook = (bookId: string) => Promise<void>;

export const useFetchBook = (): FetchBook => {
  const { loadingByBookId, setBookList, setLoadingForBook, setErrorForBook } = useContext(Context);

  return useCallback(async (bookId: string) => {
    if (loadingByBookId[bookId]) return;

    setLoadingForBook(bookId, true);
    setErrorForBook(bookId, undefined);
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}`);
      if (!response.ok) throw new Error('Book not found');
      const book = await (response.json() as Promise<Book>);
      setBookList(prev => ({ ...prev, [book.id]: book }));
    } catch (err) {
      setErrorForBook(bookId, err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingForBook(bookId, false);
    }
  }, [loadingByBookId, setBookList, setLoadingForBook, setErrorForBook]);
};
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

TypeScript errors expected on `useBookList` and `useBook` (they still destructure old return shapes). Fix in next task.

- [ ] **Step 4: Commit**

```bash
git add client/src/provider/book/hook/use-fetch-book-list.ts \
        client/src/provider/book/hook/use-fetch-book.ts
git commit -m "refactor: useFetchBookList and useFetchBook write async state to context"
```

---

## Task 12: Update useBookList and useBook to read from context

**Files:**
- Modify: `client/src/provider/book/hook/use-book-list.ts`
- Modify: `client/src/provider/book/hook/use-book.ts`

- [ ] **Step 1: Replace useBookList**

Replace the entire contents of `client/src/provider/book/hook/use-book-list.ts`:

```ts
import { useContext, useEffect, useMemo } from 'react';

import { Context } from '../context';
import type { Book } from '../type';

import { useFetchBookList } from './use-fetch-book-list';

export type UseBookList =
  | [Book[], false, false, undefined]
  | [Book[], true, false, undefined]
  | [Book[], false, true, undefined]
  | [Book[], false, true, string];

export const useBookList = (): UseBookList => {
  const { bookList, bookListLoading, bookListError } = useContext(Context);
  const fetchBookList = useFetchBookList();

  useEffect(() => {
    if (!bookListLoading && bookListError === undefined && Object.keys(bookList).length === 0) {
      void fetchBookList();
    }
  }, [fetchBookList]);

  return useMemo(
    () =>
      [
        Object.values(bookList).sort((a, b) => a.title.localeCompare(b.title)),
        bookListLoading,
        bookListError !== undefined,
        bookListError,
      ] as UseBookList,
    [bookList, bookListLoading, bookListError],
  );
};
```

- [ ] **Step 2: Replace useBook**

Replace the entire contents of `client/src/provider/book/hook/use-book.ts`:

```ts
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
  const { bookList, loadingByBookId, errorByBookId } = useContext(Context);
  const fetchBook = useFetchBook();

  const loading = loadingByBookId[bookId] ?? false;
  const errorMessage = errorByBookId[bookId];

  useEffect(() => {
    if (!loading && errorMessage === undefined && bookList[bookId] === undefined) {
      void fetchBook(bookId);
    }
  }, [fetchBook]);

  return useMemo(
    () => {
      const book = bookList[bookId];
      const isLoading = loading || (!loading && errorMessage === undefined && book === undefined);
      if (errorMessage !== undefined) return [undefined, false, true, errorMessage] as UseBook;
      if (book === undefined) return [undefined, isLoading, false, undefined] as UseBook;
      return [book, loading, false, undefined] as UseBook;
    },
    [bookList, loading, errorMessage, bookId],
  );
};
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all tests pass including `use-series-book-list.test.ts` (it mocks `useBookList` so is unaffected by internal changes).

- [ ] **Step 4: Commit**

```bash
git add client/src/provider/book/hook/use-book-list.ts \
        client/src/provider/book/hook/use-book.ts
git commit -m "refactor: useBookList and useBook read async state from context"
```

---

## Task 13: Update book mutation hooks for new setBookList and useFetchBookList signatures

Four hooks are affected:
- `useScanLibrary` and `useUploadBookList` call `const { fetchBookList } = useFetchBookList()` (old object return) — must change to `const fetchBookList = useFetchBookList()`
- `usePatchBookMetadata` and `useDeleteBook` call `setBookList(value)` — must change to `setBookList(prev => ...)`

**Files:**
- Modify: `client/src/provider/book/hook/use-scan-library.ts`
- Modify: `client/src/provider/book/hook/use-upload-book-list.ts`
- Modify: `client/src/provider/book/hook/use-patch-book-metadata.ts`
- Modify: `client/src/provider/book/hook/use-delete-book.ts`

- [ ] **Step 1: Fix useScanLibrary**

In `client/src/provider/book/hook/use-scan-library.ts`, change line 18:
```ts
// Before:
const { fetchBookList } = useFetchBookList();
// After:
const fetchBookList = useFetchBookList();
```

- [ ] **Step 2: Fix useUploadBookList**

In `client/src/provider/book/hook/use-upload-book-list.ts`, change line 9:
```ts
// Before:
const { fetchBookList } = useFetchBookList();
// After:
const fetchBookList = useFetchBookList();
```

- [ ] **Step 3: Fix usePatchBookMetadata**

In `client/src/provider/book/hook/use-patch-book-metadata.ts`:

Change the context destructure (line 8):
```ts
// Before:
const { bookList, setBookList } = useContext(Context);
// After:
const { setBookList } = useContext(Context);
```

Change the context write (line 33):
```ts
// Before:
setBookList({...bookList, [updatedBook.id]: updatedBook})
// After:
setBookList(prev => ({ ...prev, [updatedBook.id]: updatedBook }));
```

- [ ] **Step 4: Fix useDeleteBook**

In `client/src/provider/book/hook/use-delete-book.ts`:

Change the optimistic remove (line 29):
```ts
// Before:
setBookList(removeBookById(id, bookList));
// After:
setBookList(prev => removeBookById(id, prev));
```

Change the rollback (line 39):
```ts
// Before:
setBookList({...bookList, [book.id]: book});
// After:
setBookList(prev => ({ ...prev, [book.id]: book }));
```

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/provider/book/hook/use-scan-library.ts \
        client/src/provider/book/hook/use-upload-book-list.ts \
        client/src/provider/book/hook/use-patch-book-metadata.ts \
        client/src/provider/book/hook/use-delete-book.ts
git commit -m "refactor: update book mutation hooks for new BookContext shape"
```

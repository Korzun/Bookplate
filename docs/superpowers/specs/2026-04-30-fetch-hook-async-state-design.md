# Fetch Hook Async State Refactor Design

**Date:** 2026-04-30
**Status:** Approved

## Overview

The current fetch hooks (`useFetchUserProgressList`, `useFetchBookList`, etc.) each own their `loading/error/errorMessage` state via local `useState`. This creates two problems:

1. **Stale-closure race condition.** Context writes use `{...progressList, [username]: data}`, spreading a snapshot captured at callback-creation time. When multiple `UserRow` components mount simultaneously and each fires a fetch for a different username, all of them spread from the same empty snapshot — only the last writer wins and the others' data is silently discarded.

2. **Invisible usage constraint.** The in-flight guard (`if (loading) return`) uses the stale local `loading` variable, so the only way to prevent duplicate concurrent requests is to avoid calling the hook from multiple mounted components. This is an implicit, unenforced rule.

The fix lifts `loading/error` out of local component state and into the provider context alongside the data. For parameterized resources (progress by username, books by ID), async state is keyed by the resource identifier. All context writes switch to functional updater form to eliminate the race independently.

---

## Core Principle

**Fetch hooks** (those that run automatically, e.g. on mount) lift their async state into context.

**Mutation hooks** (`useDeleteUser`, `useRegisterUser`, `useDeleteUserProgress`, etc.) keep local `useState` for `loading/error` — they represent explicit one-shot user actions where no concurrent-instance problem exists.

---

## 1. Context Shape Changes

### `ProgressContext`

```ts
export type ProgressContext = {
  progressList: ProgressList;
  loadingByUsername: Record<string, boolean>;
  errorByUsername: Record<string, string | undefined>;
  setProgressForUsername: (username: string, data: UserProgressList) => void;
  setLoadingForUsername: (username: string, loading: boolean) => void;
  setErrorForUsername: (username: string, error: string | undefined) => void;
};
```

Each setter uses a functional update internally in the provider (`prev => ({...prev, [username]: value})`), so concurrent writes for different usernames cannot overwrite each other.

### `UserContext`

```ts
export type UserContext = {
  userList: UserList;
  loading: boolean;
  error: string | undefined;
  setUserList: (updater: (prev: UserList) => UserList) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | undefined) => void;
};
```

### `BookContext`

```ts
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
```

---

## 2. Fetch Hook Changes

Fetch hooks change in three ways:
- Drop local `useState` for `loading/error/errorMessage`
- Read/write context instead
- Return type simplifies from `[fn, loading, error, errorMessage]` to just `fn`

### Example: `useFetchUserProgressList`

```ts
export type FetchUserProgressList = (username: string) => Promise<void>;

export const useFetchUserProgressList = (): FetchUserProgressList => {
  const {
    loadingByUsername,
    setLoadingForUsername,
    setErrorForUsername,
    setProgressForUsername,
  } = useContext(Context);

  return useCallback(async (username: string) => {
    if (loadingByUsername[username]) return;          // guard reads context, no stale closure

    setLoadingForUsername(username, true);
    setErrorForUsername(username, undefined);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(username)}/progress`);
      if (!response.ok) throw new Error('Failed to fetch progress');
      const data = await (response.json() as Promise<Progress[]>);
      const keyed = data.reduce(
        (acc, p) => ({ ...acc, [p.document]: p }),
        {} as UserProgressList,
      );
      setProgressForUsername(username, keyed);        // functional update, no race
    } catch (err) {
      setErrorForUsername(username, err instanceof Error ? err.message : undefined);
    } finally {
      setLoadingForUsername(username, false);
    }
  }, [loadingByUsername, setLoadingForUsername, setErrorForUsername, setProgressForUsername]);
};
```

The same pattern applies to:
- `useFetchMyProgressList` — uses current username as key
- `useFetchBookList` — writes to `bookListLoading/bookListError`
- `useFetchBook` — writes to `loadingByBookId[bookId]/errorByBookId[bookId]`

---

## 3. Data Hook Changes

Data hooks (`useUserProgressList`, `useMyProgressList`, `useBookList`, `useBook`, `useUserList`) read `loading/error` directly from context. Their **return types to components are unchanged** — zero breaking changes at the call site.

### Example: `useUserProgressList`

```ts
export const useUserProgressList = (username: string | undefined): UseUserProgressList => {
  const { progressList, loadingByUsername, errorByUsername } = useContext(Context);
  const fetchUserProgressList = useFetchUserProgressList();

  const loading = username !== undefined ? (loadingByUsername[username] ?? false) : false;
  const errorMessage = username !== undefined ? errorByUsername[username] : undefined;

  useEffect(() => {
    if (username === undefined) return;
    if (progressList[username] !== undefined) return;  // data already exists
    if (loadingByUsername[username]) return;           // fetch already in flight
    void fetchUserProgressList(username);
  }, [username, progressList, loadingByUsername, fetchUserProgressList]);

  return useMemo((): UseUserProgressList => {
    if (username === undefined) return [undefined, false, false, undefined];
    if (errorMessage !== undefined) return [undefined, false, true, errorMessage];
    return [progressList[username], loading, false, undefined];
  }, [progressList, loading, errorMessage, username]);
};
```

`useUserList` follows the same pattern: reads `loading/error` from `UserContext`, guards using context state before firing, and all concurrent callers share a single in-flight fetch rather than each firing independently.

Pure derivation hooks (`useUser`, `useUserProgress`, `useMySeriesProgress`, `useUserSeriesProgress`) are unchanged — they have no async state of their own.

---

## 4. Testing

### Wrapper factories

Every `makeWrapper` in hook tests must include the new async state fields:

```ts
function makeWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [userList, setUserListRaw] = useState<UserList>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const setUserList = useCallback(
      (updater: (prev: UserList) => UserList) => setUserListRaw(updater),
      []
    );
    return (
      <Context.Provider value={{ userList, loading, error, setUserList, setLoading, setError }}>
        {children}
      </Context.Provider>
    );
  };
}
```

### Fetch hook tests

Tests that currently destructure `[fn, loading, error]` from a fetch hook must be updated to match the new single-function return type. Loading/error assertions read from the context value instead.

### New regression test: concurrent fetches

This test is broken in the current design and must pass after the refactor:

```ts
it('concurrent fetches for different usernames both persist', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    const username = decodeURIComponent(url.split('/')[3]);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([{ document: `book-${username}`, progress: 0 }]),
    });
  }));

  const { result } = renderHook(
    () => ({
      alice: useUserProgressList('alice'),
      bob: useUserProgressList('bob'),
    }),
    { wrapper: makeWrapper() }
  );

  await waitFor(() => {
    expect(result.current.alice[1]).toBe(false);
    expect(result.current.bob[1]).toBe(false);
  });

  expect(result.current.alice[0]).toBeDefined();
  expect(result.current.bob[0]).toBeDefined();
});
```

---

## Out of Scope

- Mutation hooks (`useDeleteUser`, `useRegisterUser`, `useScanLibrary`, `usePatchBookMetadata`, `useDeleteBook`, `useUploadBookList`) — `loading/error` logic unchanged; they keep local `useState`
- Pure derivation hooks (`useUser`, `useUserProgress`, `useMySeriesProgress`, `useUserSeriesProgress`) — unchanged
- Backend / Express layer — untouched

## Minor Adaptation Required: Progress Mutation Hooks

`useDeleteUserProgress` and `useDeleteMyProgress` currently call `setProgressList(value)` which is removed from `ProgressContext`. They must be updated to call `setProgressForUsername(username, newList)` instead. Their `loading/error` logic is otherwise unchanged. This is a mechanical call-site change, not a design change.

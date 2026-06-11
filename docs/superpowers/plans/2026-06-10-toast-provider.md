# Toast Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all per-component toast counter state with a `ToastProvider` / `useToast` hook that manages a capped queue of dismissible toasts with slide-in and slide-out animations.

**Architecture:** A `provider/toast/` directory containing a `useReducer`-based provider that renders a fixed-position container of `Toast` elements. Each toast entry carries an `isDismissing` flag; the auto-dismiss timer dispatches `dismiss` (not `remove`), triggering the slide-out animation; `remove` fires only after `animationEnd`. All 9 call sites are migrated to call `showToast(message, type)` in their event handlers — no local counter state needed.

**Tech Stack:** React 18, TypeScript, react-jss (`createUseStyles` from `~/provider/theme`), Vitest + Testing Library

---

## File Map

**Create:**
- `app/client/src/provider/toast/reducer.ts` — `ToastEntry` type + `toastReducer`
- `app/client/src/provider/toast/context.ts` — context type + `createContext`
- `app/client/src/provider/toast/style.ts` — container + toast JSS styles
- `app/client/src/provider/toast/toast.tsx` — internal `Toast` component (slide-in/out)
- `app/client/src/provider/toast/provider.tsx` — `ToastProvider`
- `app/client/src/provider/toast/hook/use-toast.ts` — `useToast`
- `app/client/src/provider/toast/hook/index.ts` — barrel
- `app/client/src/provider/toast/index.ts` — public barrel

**Modify:**
- `app/client/src/provider/theme/global-styles.ts` — add `theme-slide-out` keyframe
- `app/client/src/App.tsx` — add `ToastProvider` to `buildProvidersTree`
- `app/client/src/test-utils.tsx` — add `ToastProvider` to test wrapper
- `app/client/src/provider/user/hook/use-regenerate-sync-password.ts` — `regenerate()` returns `Promise<boolean>`
- `app/client/src/provider/book/hook/use-scan-library.ts` — `scanLibrary()` returns `Promise<ScanResult | null>`
- `app/client/src/provider/user/hook/use-register-user.ts` — `registerUser()` returns `Promise<boolean>`
- `app/client/src/provider/progress/hook/use-delete-my-progress.ts` — `deleteMyProgress()` returns `Promise<boolean>`
- `app/client/src/provider/progress/hook/use-delete-user-progress.ts` — `deleteUserProgress()` returns `Promise<boolean>`
- `app/client/src/component/library-scan/index.tsx` — migrate to `useToast`
- `app/client/src/component/user-register/index.tsx` — migrate to `useToast`
- `app/client/src/component/sync-password/index.tsx` — migrate to `useToast`
- `app/client/src/component/user-change-password/index.tsx` — migrate to `useToast`
- `app/client/src/component/my-progress-row/index.tsx` — migrate to `useToast`
- `app/client/src/component/my-progress-row/index.test.tsx` — wrap in `ToastProvider`
- `app/client/src/component/user-progress-row/index.tsx` — migrate to `useToast`
- `app/client/src/component/user-progress-row/index.test.tsx` — wrap in `ToastProvider`
- `app/client/src/control/reset-password-button/index.tsx` — migrate to `useToast`
- `app/client/src/control/reset-password-button/index.test.tsx` — wrap in `ToastProvider`
- `app/client/src/page/book-edit/index.tsx` — migrate to `useToast`
- `app/client/src/page/login/index.tsx` — migrate to `useToast`
- `app/client/src/component/index.ts` — remove `Toast` export

**Delete:**
- `app/client/src/component/toast/index.tsx`
- `app/client/src/component/toast/style.ts`

---

## Task 1: Add `theme-slide-out` keyframe

**Files:**
- Modify: `app/client/src/provider/theme/global-styles.ts`

- [ ] **Step 1: Add the keyframe**

  In `global-styles.ts`, after the `@keyframes theme-slide-in` block, add:

  ```ts
  '@keyframes theme-slide-out': {
    from: { opacity: 1, transform: 'translateY(0)' },
    to: { opacity: 0, transform: 'translateY(0.4rem)' },
  },
  ```

  Full updated `useGlobalStyles` call:

  ```ts
  const useGlobalStyles = createUseStyles((theme: Theme) => ({
    '@global': {
      body: {
        fontFamily: theme.fontFamily.body,
        backgroundColor: theme.color.bg.page,
        color: theme.color.text.primary,
        minHeight: '100vh',
      },
      'body:has(dialog[open])': {
        overflow: 'hidden',
      },
      '@keyframes theme-rotation': {
        '0%': { transform: 'rotate(0deg)' },
        '100%': { transform: 'rotate(360deg)' },
      },
      '@keyframes theme-slide-in': {
        from: { opacity: 0, transform: 'translateY(0.4rem)' },
        to: { opacity: 1, transform: 'translateY(0)' },
      },
      '@keyframes theme-slide-out': {
        from: { opacity: 1, transform: 'translateY(0)' },
        to: { opacity: 0, transform: 'translateY(0.4rem)' },
      },
    },
  }));
  ```

- [ ] **Step 2: Run tests to confirm no regressions**

  ```bash
  cd app/client && npm test
  ```

  Expected: all existing tests pass.

- [ ] **Step 3: Commit**

  ```bash
  git add app/client/src/provider/theme/global-styles.ts
  git commit -m "feat: add theme-slide-out keyframe for toast exit animation"
  ```

---

## Task 2: Create `provider/toast/reducer.ts` and `provider/toast/context.ts`

**Files:**
- Create: `app/client/src/provider/toast/reducer.ts`
- Create: `app/client/src/provider/toast/context.ts`

- [ ] **Step 1: Create `reducer.ts`**

  ```ts
  // app/client/src/provider/toast/reducer.ts
  export type ToastEntry = {
    id: number;
    message: string;
    type: 'success' | 'error';
    isDismissing: boolean;
  };

  export type ToastAction =
    | { type: 'add'; id: number; message: string; toastType: 'success' | 'error'; maxToasts: number }
    | { type: 'dismiss'; id: number }
    | { type: 'remove'; id: number };

  export function toastReducer(state: ToastEntry[], action: ToastAction): ToastEntry[] {
    switch (action.type) {
      case 'add': {
        const next: ToastEntry = {
          id: action.id,
          message: action.message,
          type: action.toastType,
          isDismissing: false,
        };
        if (state.length >= action.maxToasts) {
          return [
            ...state.map((t, i) => (i === 0 ? { ...t, isDismissing: true } : t)),
            next,
          ];
        }
        return [...state, next];
      }
      case 'dismiss':
        return state.map((t) => (t.id === action.id ? { ...t, isDismissing: true } : t));
      case 'remove':
        return state.filter((t) => t.id !== action.id);
    }
  }
  ```

- [ ] **Step 2: Create `context.ts`**

  ```ts
  // app/client/src/provider/toast/context.ts
  import { createContext } from 'react';

  export type ToastContext = {
    showToast: (message: string, type: 'success' | 'error') => void;
  };

  export const Context = createContext<ToastContext>({
    showToast: () => {},
  });
  ```

---

## Task 3: Create `provider/toast/style.ts`

**Files:**
- Create: `app/client/src/provider/toast/style.ts`

- [ ] **Step 1: Create the styles**

  The container is `position: fixed`; individual toasts are plain block elements inside it. The `toastExiting` class overrides the `animation` property (JSS injects classes in declaration order, so `toastExiting` wins when both are applied).

  ```ts
  // app/client/src/provider/toast/style.ts
  import { createUseStyles, type Theme } from '~/provider/theme';

  export const useStyle = createUseStyles((theme: Theme) => ({
    container: {
      position: 'fixed' as const,
      bottom: theme.space.xxxxl,
      right: theme.space.xxxxl,
      zIndex: theme.zIndex.toast,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: theme.space.md,
      alignItems: 'flex-end',
    },
    toast: {
      display: 'flex',
      alignItems: 'center',
      gap: theme.space.md,
      padding: `${theme.space.lg} ${theme.space.xxl}`,
      borderRadius: theme.radius.md,
      fontSize: theme.fontSize.md,
      fontWeight: theme.fontWeight.medium,
      color: theme.color.text.primary,
      background: theme.color.bg.card,
      boxShadow: theme.shadow.hoverLift,
      animation: `theme-slide-in ${theme.transition.slide}`,
    },
    toastExiting: {
      animation: `theme-slide-out ${theme.transition.slide}`,
      animationFillMode: 'forwards' as const,
    },
    iconSuccess: { display: 'flex', color: theme.color.success },
    iconError: { display: 'flex', color: theme.color.danger.default },
  }));
  ```

---

## Task 4: Create `provider/toast/toast.tsx`

**Files:**
- Create: `app/client/src/provider/toast/toast.tsx`

This is the internal `Toast` component used only by the provider. It is not exported from the public barrel. The `onDismiss`/`onRemove` callbacks accept an `id` so they can be created once in the provider with `useCallback` and remain stable — preventing the auto-dismiss timer from resetting on every re-render.

- [ ] **Step 1: Create the component**

  ```tsx
  // app/client/src/provider/toast/toast.tsx
  import { useEffect } from 'react';

  import { CheckIcon, XIcon } from '~/icon';

  import { useStyle } from './style';

  interface Props {
    id: number;
    message: string;
    type: 'success' | 'error';
    isDismissing: boolean;
    duration: number;
    onDismiss: (id: number) => void;
    onRemove: (id: number) => void;
  }

  export const Toast = ({ id, message, type, isDismissing, duration, onDismiss, onRemove }: Props) => {
    const styles = useStyle();

    useEffect(() => {
      if (isDismissing) return;
      const timer = setTimeout(() => onDismiss(id), duration);
      return () => clearTimeout(timer);
    }, [isDismissing, id, onDismiss, duration]);

    return (
      <div
        className={isDismissing ? `${styles.toast} ${styles.toastExiting}` : styles.toast}
        onAnimationEnd={isDismissing ? () => onRemove(id) : undefined}
      >
        <span className={type === 'success' ? styles.iconSuccess : styles.iconError}>
          {type === 'success' ? (
            <CheckIcon width={16} height={16} />
          ) : (
            <XIcon width={16} height={16} />
          )}
        </span>
        {message}
      </div>
    );
  };
  ```

---

## Task 5: Create `provider/toast/provider.tsx`

**Files:**
- Create: `app/client/src/provider/toast/provider.tsx`

- [ ] **Step 1: Create the provider**

  `handleDismiss` and `handleRemove` are created once (`[]` deps) because `dispatch` from `useReducer` is stable. Passing them to `Toast` ensures the auto-dismiss timer does not restart on re-renders.

  ```tsx
  // app/client/src/provider/toast/provider.tsx
  import { type ReactNode, useCallback, useReducer, useRef } from 'react';

  import { Context } from './context';
  import { toastReducer } from './reducer';
  import { useStyle } from './style';
  import { Toast } from './toast';

  const TOAST_DURATION = 4000;

  type ToastProviderProps = {
    children: ReactNode;
    maxToasts?: number;
  };

  export const ToastProvider = ({ children, maxToasts = 3 }: ToastProviderProps) => {
    const styles = useStyle();
    const [toasts, dispatch] = useReducer(toastReducer, []);
    const nextId = useRef(0);

    const showToast = useCallback(
      (message: string, type: 'success' | 'error') => {
        const id = nextId.current++;
        dispatch({ type: 'add', id, message, toastType: type, maxToasts });
      },
      [maxToasts]
    );

    const handleDismiss = useCallback((id: number) => {
      dispatch({ type: 'dismiss', id });
    }, []);

    const handleRemove = useCallback((id: number) => {
      dispatch({ type: 'remove', id });
    }, []);

    return (
      <Context.Provider value={{ showToast }}>
        {children}
        <div className={styles.container}>
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              id={toast.id}
              message={toast.message}
              type={toast.type}
              isDismissing={toast.isDismissing}
              duration={TOAST_DURATION}
              onDismiss={handleDismiss}
              onRemove={handleRemove}
            />
          ))}
        </div>
      </Context.Provider>
    );
  };
  ```

---

## Task 6: Create hook + barrels, wire into App and test-utils

**Files:**
- Create: `app/client/src/provider/toast/hook/use-toast.ts`
- Create: `app/client/src/provider/toast/hook/index.ts`
- Create: `app/client/src/provider/toast/index.ts`
- Modify: `app/client/src/App.tsx`
- Modify: `app/client/src/test-utils.tsx`

- [ ] **Step 1: Create `hook/use-toast.ts`**

  ```ts
  // app/client/src/provider/toast/hook/use-toast.ts
  import { useContext } from 'react';

  import { Context } from '../context';

  export const useToast = (): ((message: string, type: 'success' | 'error') => void) => {
    const { showToast } = useContext(Context);
    return showToast;
  };
  ```

- [ ] **Step 2: Create `hook/index.ts`**

  ```ts
  // app/client/src/provider/toast/hook/index.ts
  export { useToast } from './use-toast';
  ```

- [ ] **Step 3: Create `provider/toast/index.ts`**

  ```ts
  // app/client/src/provider/toast/index.ts
  export { ToastProvider } from './provider';
  export { useToast } from './hook';
  ```

- [ ] **Step 4: Add `ToastProvider` to `App.tsx`**

  ```tsx
  // app/client/src/App.tsx
  import { buildProvidersTree } from './provider';
  import { AuthProvider } from './provider/auth';
  import { BookProvider } from './provider/book';
  import { ProgressProvider } from './provider/progress';
  import { ThemeProvider } from './provider/theme';
  import { ToastProvider } from './provider/toast';
  import { UserProvider } from './provider/user';
  import { AppRouter } from './router/';

  const ProvidersTree = buildProvidersTree([
    [ThemeProvider],
    [AuthProvider],
    [UserProvider],
    [BookProvider],
    [ProgressProvider],
    [ToastProvider],
  ]);

  export const App = () => (
    <ProvidersTree>
      <AppRouter />
    </ProvidersTree>
  );
  ```

- [ ] **Step 5: Add `ToastProvider` to `test-utils.tsx`**

  ```tsx
  // app/client/src/test-utils.tsx
  import { render, type RenderOptions } from '@testing-library/react';
  import type { ReactElement, ReactNode } from 'react';
  import { MemoryRouter } from 'react-router-dom';

  import {
    Context as AuthContext,
    type AuthContext as AuthContextType,
  } from './provider/auth/context';
  import { ThemeProvider } from './provider/theme/provider';
  import { ToastProvider } from './provider/toast';

  interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
    user?: { username: string; isAdmin: boolean; mustChangePassword?: boolean };
    initialEntries?: string[];
  }

  export function renderWithProviders(
    ui: ReactElement,
    {
      user = { username: '', isAdmin: false },
      initialEntries,
      ...options
    }: RenderWithProvidersOptions = {}
  ) {
    const authState: AuthContextType = {
      ...user,
      mustChangePassword: user.mustChangePassword ?? false,
      loading: false,
      error: false,
      errorMessage: undefined,
      setUsername: () => {},
      setIsAdmin: () => {},
      setMustChangePassword: () => {},
      refetch: () => Promise.resolve(),
    };

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <MemoryRouter initialEntries={initialEntries}>
          <ThemeProvider>
            <ToastProvider>
              <AuthContext.Provider value={authState}>{children}</AuthContext.Provider>
            </ToastProvider>
          </ThemeProvider>
        </MemoryRouter>
      );
    }
    return render(ui, { wrapper: Wrapper, ...options });
  }
  ```

- [ ] **Step 6: Run tests — confirm everything still passes before any migrations**

  ```bash
  cd app/client && npm test
  ```

  Expected: all 361 tests pass. The old `Toast` component still exists; no call sites have been migrated yet.

- [ ] **Step 7: Run type check**

  ```bash
  npm run type
  ```

  Expected: clean.

- [ ] **Step 8: Commit**

  ```bash
  git add app/client/src/provider/toast/ app/client/src/App.tsx app/client/src/test-utils.tsx
  git commit -m "feat: add ToastProvider and useToast hook"
  ```

---

## Task 7: Update hooks to return async results

The 5 hooks below currently return `Promise<void>` from their async function. The migration requires calling `showToast` in event handlers after `await`-ing the operation, so they must resolve with a result. Hook-level state (`loading`, `error`, etc.) is unchanged — the tuple return shape stays the same, only the inner function's resolved type changes.

**Files:**
- Modify: `app/client/src/provider/user/hook/use-regenerate-sync-password.ts`
- Modify: `app/client/src/provider/book/hook/use-scan-library.ts`
- Modify: `app/client/src/provider/user/hook/use-register-user.ts`
- Modify: `app/client/src/provider/progress/hook/use-delete-my-progress.ts`
- Modify: `app/client/src/provider/progress/hook/use-delete-user-progress.ts`

- [ ] **Step 1: Update `use-regenerate-sync-password.ts`**

  Change `regenerate` return type from `Promise<void>` to `Promise<boolean>`. Add `return false` to all error paths, `return true` to the success path.

  ```ts
  // app/client/src/provider/user/hook/use-regenerate-sync-password.ts
  import { useCallback, useState } from 'react';

  export const useRegenerateSyncPassword = (): [
    () => Promise<boolean>,
    boolean,
    string | null,
    boolean,
  ] => {
    const [loading, setLoading] = useState(false);
    const [syncPassword, setSyncPassword] = useState<string | null>(null);
    const [error, setError] = useState(false);

    const regenerate = useCallback(async (): Promise<boolean> => {
      setLoading(true);
      setError(false);
      setSyncPassword(null);
      try {
        const res = await fetch('/api/my/sync-password/regenerate', { method: 'POST' });
        if (res.status !== 200) {
          setError(true);
          return false;
        }
        const data = (await res.json()) as { syncPassword: string };
        setSyncPassword(data.syncPassword);
        return true;
      } catch {
        setError(true);
        return false;
      } finally {
        setLoading(false);
      }
    }, []);

    return [regenerate, loading, syncPassword, error];
  };
  ```

- [ ] **Step 2: Update `use-scan-library.ts`**

  Change `scanLibrary` return type from `Promise<void>` to `Promise<ScanResult | null>`. Return the result on success, `null` on error.

  ```ts
  // app/client/src/provider/book/hook/use-scan-library.ts
  import { useCallback, useContext, useMemo, useState } from 'react';

  import { Context } from '../context';

  import { useFetchBookList } from './use-fetch-book-list';

  export type ScanResult = {
    imported: string[];
    removed: string[];
  };

  export type ScanLibrary = () => Promise<ScanResult | null>;
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
      if (loading) return null;

      setLoading(true);
      setError(false);
      setErrorMessage(undefined);
      setScanResult(undefined);

      try {
        const response = await fetch('/api/books/scan', { method: 'POST' });
        if (!response.ok) throw new Error('Scan failed');
        const result = await (response.json() as Promise<ScanResult>);
        setScanResult(result);
        clearCompleteBookIds();
        fetchBookList();
        return result;
      } catch (err) {
        setError(true);
        if (err instanceof Error) setErrorMessage(err.message);
        return null;
      } finally {
        setLoading(false);
      }
    }, [fetchBookList, clearCompleteBookIds, loading]);

    return useMemo(
      () => [scanLibrary, scanResult, loading, error, errorMessage] as UseScanLibrary,
      [scanLibrary, scanResult, loading, error, errorMessage]
    );
  };
  ```

- [ ] **Step 3: Update `use-register-user.ts`**

  Change `registerUser` return type to `Promise<boolean>`.

  ```ts
  export type RegisterUser = (username: string, password: string) => Promise<boolean>;
  ```

  Add `return false` before the guard early-returns, `return true` after `setOkay(true)`, and `return false` in the catch block. The full function body:

  ```ts
  const registerUser = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      setOkay(false);

      if (!username.trim() || !password) {
        setError(true);
        setErrorMessage('Username and password are required');
        return false;
      }

      if (userList[username] !== undefined) {
        setError(true);
        setErrorMessage('Username already taken');
        return false;
      }

      setUserList((prev) => ({ ...prev, [username]: { username, progressCount: 0 } }));

      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const response = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (response.status !== 201) throw new Error('Registration failed');
        setOkay(true);
        return true;
      } catch (err) {
        setError(true);
        setUserList((prev) => removeUserByUsername(username, prev));
        if (err instanceof Error) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage('Registration failed');
        }
        return false;
      } finally {
        setLoading(false);
      }
    },
    [userList, setUserList]
  );
  ```

  Also update the `UseRegisterUser` type's first element: `RegisterUser` (already defined above) should reflect the new signature. In `use-register-user.ts`, the `UseRegisterUser` type references `RegisterUser`, so updating the `RegisterUser` type is sufficient.

- [ ] **Step 4: Update `use-delete-my-progress.ts`**

  Change `DeleteMyProgress` return type to `Promise<boolean>`.

  ```ts
  export type DeleteMyProgress = (bookId: string) => Promise<boolean>;
  ```

  Update the function body — add `return false` to guard paths, `return true` on success, `return false` in catch:

  ```ts
  const deleteMyProgress = useCallback(
    async (bookId: string): Promise<boolean> => {
      if (deleting || username === undefined) return false;

      const userProgressList = progressList[username];
      const progress = userProgressList?.[bookId];
      if (progress === undefined) {
        setError(true);
        setErrorMessage('Failed to clear progress');
        return false;
      }

      setProgressForUsername(username, removeProgressById(bookId, userProgressList));

      try {
        setDeleting(true);
        setError(false);
        setErrorMessage(undefined);
        const response = await fetch(`/api/my/progress/${encodeURIComponent(bookId)}`, {
          method: 'DELETE',
        });
        if (response.status !== 204) throw new Error('Failed to clear progress');
        return true;
      } catch (err) {
        setError(true);
        setProgressForUsername(username, { ...userProgressList, [bookId]: progress });
        if (err instanceof Error) setErrorMessage(err.message);
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [progressList, setProgressForUsername, username, deleting]
  );
  ```

- [ ] **Step 5: Update `use-delete-user-progress.ts`**

  Change `DeleteUserProgress` return type to `Promise<boolean>` with the same pattern (return false on guard/error paths, return true on success):

  ```ts
  export type DeleteUserProgress = (bookId: string) => Promise<boolean>;
  ```

  The function body follows the same pattern as `useDeleteMyProgress` in Step 4.

  ```ts
  const deleteUserProgress = useCallback(
    async (bookId: string): Promise<boolean> => {
      if (deleting || username === undefined) return false;

      const userProgressList = progressList[username ?? ''];
      const progress = userProgressList?.[bookId];
      if (progress === undefined) {
        setError(true);
        setErrorMessage('Failed to delete progress');
        return false;
      }

      setProgressForUsername(username, removeProgressById(bookId, userProgressList));

      try {
        setDeleting(true);
        setError(false);
        setErrorMessage(undefined);
        const response = await fetch(
          `/api/users/${encodeURIComponent(username)}/progress/${encodeURIComponent(bookId)}`,
          { method: 'DELETE' }
        );
        if (response.status !== 204) throw new Error('Failed to clear progress');
        return true;
      } catch (err) {
        setError(true);
        setProgressForUsername(username, { ...userProgressList, [bookId]: progress });
        if (err instanceof Error) setErrorMessage(err.message);
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [progressList, setProgressForUsername, username, deleting]
  );
  ```

- [ ] **Step 6: Run type check and tests**

  ```bash
  cd app/client && npm run type && npm test
  ```

  Expected: clean types, all tests pass. The hook tests check observable state (loading/error) but not return values — no test changes needed.

- [ ] **Step 7: Commit**

  ```bash
  git add app/client/src/provider/user/hook/use-regenerate-sync-password.ts \
          app/client/src/provider/book/hook/use-scan-library.ts \
          app/client/src/provider/user/hook/use-register-user.ts \
          app/client/src/provider/progress/hook/use-delete-my-progress.ts \
          app/client/src/provider/progress/hook/use-delete-user-progress.ts
  git commit -m "refactor: hooks return async result for toast integration"
  ```

---

## Task 8: Migrate `library-scan`, `user-register`, `sync-password`

**Files:**
- Modify: `app/client/src/component/library-scan/index.tsx`
- Modify: `app/client/src/component/user-register/index.tsx`
- Modify: `app/client/src/component/sync-password/index.tsx`

- [ ] **Step 1: Rewrite `library-scan/index.tsx`**

  ```tsx
  // app/client/src/component/library-scan/index.tsx
  import { useCallback } from 'react';

  import { Button } from '~/control/button';
  import { useScanLibrary } from '~/provider/book';
  import { useToast } from '~/provider/toast';

  import { useStyle } from './style';

  interface Props {
    disabled?: boolean;
  }

  export const LibraryScan = ({ disabled }: Props) => {
    const styles = useStyle();
    const [scanLibrary, , scanning] = useScanLibrary();
    const showToast = useToast();

    const handleScan = useCallback(async () => {
      const result = await scanLibrary();
      if (result === null) {
        showToast('Scan failed', 'error');
      } else {
        const changed = result.imported.length + result.removed.length;
        showToast(
          changed === 0
            ? 'Library already up to date'
            : `Scan complete: ${result.imported.length} imported, ${result.removed.length} removed`,
          'success'
        );
      }
    }, [scanLibrary, showToast]);

    return (
      <div className={styles.root}>
        <Button disabled={disabled} loading={scanning} onClick={handleScan}>
          {scanning ? 'Scanning…' : 'Library scan'}
        </Button>
      </div>
    );
  };
  ```

- [ ] **Step 2: Rewrite `user-register/index.tsx`**

  ```tsx
  // app/client/src/component/user-register/index.tsx
  import { useCallback, useState } from 'react';

  import { Card } from '~/component';
  import { Button, TextInput } from '~/control';
  import { useToast } from '~/provider/toast';
  import { useRegisterUser } from '~/provider/user';

  import { useStyle } from './style';

  export const UserRegister = () => {
    const styles = useStyle();
    const [registerUser, loading] = useRegisterUser();
    const showToast = useToast();
    const [username, setUsername] = useState<string>('');
    const [password, setPassword] = useState<string>('');

    const handleRegisterUser = useCallback(async () => {
      const ok = await registerUser(username, password);
      if (ok) {
        showToast('User registered', 'success');
      } else {
        showToast('Registration failed', 'error');
      }
    }, [registerUser, username, password, showToast]);

    const handleUsernameChange = useCallback((newValue: string | undefined) => {
      setUsername(newValue ?? '');
    }, []);

    const handlePasswordChange = useCallback((newValue: string | undefined) => {
      setPassword(newValue ?? '');
    }, []);

    return (
      <Card title="Register new User">
        <div className={styles.inputContainer}>
          <TextInput
            name="username"
            value={username}
            onChange={handleUsernameChange}
            layout="horizontal"
            label="Username"
            autoComplete="off"
          />
          <TextInput
            name="password"
            password
            value={password}
            onChange={handlePasswordChange}
            layout="horizontal"
            label="Password"
            autoComplete="off"
          />
        </div>
        <Button type="primary" loading={loading} onClick={handleRegisterUser}>
          {loading ? 'Registering…' : 'Register'}
        </Button>
      </Card>
    );
  };
  ```

- [ ] **Step 3: Rewrite `sync-password/index.tsx`**

  ```tsx
  // app/client/src/component/sync-password/index.tsx
  import { Fragment, useCallback, useState } from 'react';

  import { Card } from '~/component';
  import { Button, ConfirmModal } from '~/control';
  import { useToast } from '~/provider/toast';
  import { useRegenerateSyncPassword, useSyncPassword } from '~/provider/user';

  import { useStyle } from './style';

  export const SyncPassword = () => {
    const styles = useStyle();
    const [syncPassword, loadingFetch, fetchError] = useSyncPassword();
    const [regenerate, regenerating, newPassword] = useRegenerateSyncPassword();
    const showToast = useToast();

    const displayPassword = newPassword ?? syncPassword;

    const [showConfirm, setShowConfirm] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
      if (!displayPassword) return;
      await navigator.clipboard.writeText(displayPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, [displayPassword]);

    const handleRegenerateClick = useCallback(() => setShowConfirm(true), []);
    const handleCancel = useCallback(() => setShowConfirm(false), []);
    const handleConfirm = useCallback(async () => {
      setShowConfirm(false);
      const ok = await regenerate();
      if (ok) {
        showToast('Sync password regenerated', 'success');
      } else {
        showToast('Failed to regenerate sync password', 'error');
      }
    }, [regenerate, showToast]);

    return (
      <Fragment>
        <Card isCollapsible defaultCollapsed title="Sync password">
          {fetchError && <div>Failed to load sync password.</div>}
          {!fetchError && (
            <div className={styles.row}>
              <span className={styles.password}>{loadingFetch ? '…' : (displayPassword ?? '—')}</span>
              <Button type="default" disabled={!displayPassword || loadingFetch} onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
              <Button
                type="default"
                loading={regenerating}
                disabled={loadingFetch}
                onClick={handleRegenerateClick}
              >
                Regenerate
              </Button>
            </div>
          )}
        </Card>

        <ConfirmModal
          isOpen={showConfirm}
          title="Regenerate sync password?"
          confirmText="Regenerate"
          cancelText="Cancel"
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        >
          This will create a new sync password. Your KoReader devices and any OPDS clients will stop
          syncing until you update them with the new password.
        </ConfirmModal>
      </Fragment>
    );
  };
  ```

- [ ] **Step 4: Run type check and tests**

  ```bash
  cd app/client && npm run type && npm test
  ```

  Expected: clean.

- [ ] **Step 5: Commit**

  ```bash
  git add app/client/src/component/library-scan/index.tsx \
          app/client/src/component/user-register/index.tsx \
          app/client/src/component/sync-password/index.tsx
  git commit -m "refactor: migrate library-scan, user-register, sync-password to useToast"
  ```

---

## Task 9: Migrate `user-change-password`

**Files:**
- Modify: `app/client/src/component/user-change-password/index.tsx`

- [ ] **Step 1: Rewrite `user-change-password/index.tsx`**

  ```tsx
  // app/client/src/component/user-change-password/index.tsx
  import { useCallback, useState } from 'react';

  import { Card } from '~/component';
  import { Button, TextInput } from '~/control';
  import { useAuthRefresh } from '~/provider/auth';
  import { useToast } from '~/provider/toast';
  import { useChangeMyPassword } from '~/provider/user';

  import { useStyle } from './style';

  export const UserChangePassword = () => {
    const styles = useStyle();
    const refetchAuth = useAuthRefresh();
    const [changeMyPassword, loading] = useChangeMyPassword();
    const showToast = useToast();
    const [currentPassword, setCurrentPassword] = useState<string>('');
    const [newPassword, setNewPassword] = useState<string>('');
    const [confirmPassword, setConfirmPassword] = useState<string>('');
    const [isPasswordValid, setIsPasswordValid] = useState<boolean>(false);

    const handleChangePassword = useCallback(async () => {
      const changed = await changeMyPassword(currentPassword, newPassword);
      if (changed) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setIsPasswordValid(false);
        void refetchAuth();
        showToast('Password changed', 'success');
      } else {
        showToast('Password change failed', 'error');
      }
    }, [changeMyPassword, currentPassword, newPassword, refetchAuth, showToast]);

    const handleCurrentPasswordChange = useCallback((newValue: string | undefined) => {
      setCurrentPassword(newValue ?? '');
    }, []);
    const handleNewPasswordChange = useCallback((newValue: string | undefined) => {
      setNewPassword(newValue ?? '');
      setConfirmPassword('');
      setIsPasswordValid(false);
    }, []);
    const handleConfirmPasswordChange = useCallback((newValue: string | undefined) => {
      setConfirmPassword(newValue ?? '');
    }, []);
    const handleConfirmPasswordValidation = useCallback(
      (newValue: string): boolean => {
        const isValid = newPassword.length > 0 && newValue.length > 0 && newValue === newPassword;
        setIsPasswordValid(isValid);
        return isValid;
      },
      [newPassword]
    );

    return (
      <Card isCollapsible defaultCollapsed title="Change password">
        <div className={styles.inputContainer}>
          <TextInput
            name="current-password"
            password
            value={currentPassword}
            onChange={handleCurrentPasswordChange}
            layout="horizontal"
            label="Current"
            autoComplete="off"
          />
          <TextInput
            name="new-password"
            password
            value={newPassword}
            onChange={handleNewPasswordChange}
            layout="horizontal"
            label="New"
            autoComplete="off"
          />
          <TextInput
            name="confirm-new-password"
            password
            value={confirmPassword}
            onChange={handleConfirmPasswordChange}
            layout="horizontal"
            label="Confirm"
            autoComplete="off"
            validate={handleConfirmPasswordValidation}
          />
        </div>
        <Button
          type="primary"
          loading={loading}
          onClick={handleChangePassword}
          disabled={
            !isPasswordValid ||
            currentPassword.length === 0 ||
            newPassword.length === 0 ||
            confirmPassword.length === 0
          }
        >
          {loading ? 'Changing…' : 'Change password'}
        </Button>
      </Card>
    );
  };
  ```

- [ ] **Step 2: Run type check and tests**

  ```bash
  cd app/client && npm run type && npm test
  ```

  Expected: clean.

- [ ] **Step 3: Commit**

  ```bash
  git add app/client/src/component/user-change-password/index.tsx
  git commit -m "refactor: migrate user-change-password to useToast"
  ```

---

## Task 10: Migrate `my-progress-row`

**Files:**
- Modify: `app/client/src/component/my-progress-row/index.tsx`
- Modify: `app/client/src/component/my-progress-row/index.test.tsx`

The test currently asserts toast text appears. After migration, toasts are rendered by `ToastProvider`. Because `test-utils.tsx` now wraps in `ToastProvider` (added in Task 6), the assertions work unchanged — only the import of `Toast` in the component is removed.

- [ ] **Step 1: Rewrite `my-progress-row/index.tsx`**

  ```tsx
  // app/client/src/component/my-progress-row/index.tsx
  import { Fragment, useCallback, useState } from 'react';

  import { Button, ConfirmModal } from '~/control';
  import { AlertOctagonIcon } from '~/icon';
  import { useBook } from '~/provider/book';
  import { useDeleteMyProgress, useMyProgress } from '~/provider/progress';
  import { useToast } from '~/provider/toast';
  import { relativeTime } from '~/utils';

  import { ProgressIndicator } from '../progress-indicator';

  import { useStyle } from './style';

  interface MyProgressRowProps {
    bookId: string;
  }

  export const MyProgressRow = ({ bookId }: MyProgressRowProps) => {
    const styles = useStyle();

    const [book] = useBook(bookId);
    const [progress, progressLoading, progressError] = useMyProgress(bookId);
    const [deleteMyProgress, deleting] = useDeleteMyProgress();
    const showToast = useToast();

    const [showModal, setShowModal] = useState(false);

    const handleClear = useCallback(() => setShowModal(true), []);
    const handleCancel = useCallback(() => setShowModal(false), []);
    const handleConfirm = useCallback(async () => {
      setShowModal(false);
      const ok = await deleteMyProgress(bookId);
      if (ok) {
        showToast('Progress cleared', 'success');
      } else {
        showToast('Failed to clear progress', 'error');
      }
    }, [deleteMyProgress, bookId, showToast]);

    if (progressLoading) {
      return <div className={styles.loading}>Loading…</div>;
    }
    if (progressError) {
      return <div className={styles.error}>Error loading progress</div>;
    }
    if (progress === undefined) {
      return null;
    }

    const bookTitle = book?.title ?? progress.document;

    const metadataList: string[] = [];
    if (progress.device) metadataList.push(progress.device);
    if (progress.timestamp != null) metadataList.push(relativeTime(progress.timestamp));

    return (
      <Fragment>
        <div className={styles.root}>
          <div className={styles.progress}>
            <ProgressIndicator value={progress.percentage} size={14} />
          </div>
          <div className={styles.book}>{bookTitle}</div>
          <div className={styles.metadata}>{metadataList.join(' · ')}</div>
          <Button type="link" danger onClick={handleClear} loading={deleting}>
            Clear
          </Button>
        </div>
        {showModal && (
          <ConfirmModal
            isOpen
            onCancel={handleCancel}
            onConfirm={handleConfirm}
            icon={AlertOctagonIcon}
            danger
            title="Clear reading progress?"
            confirmText="Clear"
            loading={deleting}
          >
            This will remove your synced reading progress for <strong>{bookTitle}</strong>.
          </ConfirmModal>
        )}
      </Fragment>
    );
  };
  ```

- [ ] **Step 2: Check `my-progress-row/index.test.tsx`**

  Open the file and verify the toast assertions (`screen.getByText('Progress cleared')`, `screen.getByText('Failed to clear progress')`) still use `renderWithProviders`. Since `ToastProvider` is now in the wrapper, they work without changes. No edit needed.

- [ ] **Step 3: Run tests to confirm**

  ```bash
  cd app/client && npm test -- my-progress-row
  ```

  Expected: all tests in this file pass including the toast assertions.

- [ ] **Step 4: Commit**

  ```bash
  git add app/client/src/component/my-progress-row/index.tsx
  git commit -m "refactor: migrate my-progress-row to useToast"
  ```

---

## Task 11: Migrate `user-progress-row`

**Files:**
- Modify: `app/client/src/component/user-progress-row/index.tsx`
- Check: `app/client/src/component/user-progress-row/index.test.tsx`

- [ ] **Step 1: Rewrite `user-progress-row/index.tsx`**

  ```tsx
  // app/client/src/component/user-progress-row/index.tsx
  import { Fragment, useCallback, useState } from 'react';

  import { Button, ConfirmModal, LinkProgressModal } from '~/control';
  import { AlertOctagonIcon } from '~/icon';
  import { useIsAdmin } from '~/provider/auth';
  import { useBook } from '~/provider/book';
  import { useDeleteUserProgress, useUserProgress } from '~/provider/progress';
  import { useToast } from '~/provider/toast';
  import { relativeTime } from '~/utils';

  import { ProgressIndicator } from '../progress-indicator';

  import { useStyle } from './style';

  interface UserProgressRowProps {
    bookId: string;
    username: string;
  }

  export const UserProgressRow = ({ bookId, username }: UserProgressRowProps) => {
    const styles = useStyle();

    const [isAdmin] = useIsAdmin();
    const [book, bookLoading] = useBook(bookId);
    const [progress, progressLoading, progressError] = useUserProgress(username, bookId);
    const [deleteUserProgress, deleting] = useDeleteUserProgress(username);
    const showToast = useToast();

    const [showClearModal, setShowClearModal] = useState(false);
    const [showLinkModal, setShowLinkModal] = useState(false);

    const handleClear = useCallback(() => setShowClearModal(true), []);
    const handleCancelClear = useCallback(() => setShowClearModal(false), []);
    const handleConfirmClear = useCallback(async () => {
      setShowClearModal(false);
      const ok = await deleteUserProgress(bookId);
      if (ok) {
        showToast('Progress cleared', 'success');
      } else {
        showToast('Failed to clear progress', 'error');
      }
    }, [deleteUserProgress, bookId, showToast]);

    if (progressLoading) {
      return <div className={styles.loading}>Loading…</div>;
    }
    if (progressError) {
      return <div className={styles.error}>Error loading progress</div>;
    }
    if (progress === undefined) {
      return null;
    }

    const bookTitle = book?.title ?? progress.document;
    const isUnresolved = book === undefined && !bookLoading;

    const metadataList: string[] = [];
    if (progress.device) metadataList.push(progress.device);
    if (progress.timestamp != null) metadataList.push(relativeTime(progress.timestamp));

    return (
      <Fragment>
        <div className={styles.root}>
          <div className={styles.progress}>
            <ProgressIndicator value={progress.percentage} size={14} />
          </div>
          <div className={styles.book}>{bookTitle}</div>
          <div className={styles.metadata}>{metadataList.join(' · ')}</div>
          {isUnresolved && isAdmin && (
            <Button type="link" onClick={() => setShowLinkModal(true)}>
              Link
            </Button>
          )}
          <Button type="link" danger onClick={handleClear} loading={deleting}>
            Clear
          </Button>
        </div>
        {showClearModal && (
          <ConfirmModal
            isOpen
            onCancel={handleCancelClear}
            onConfirm={handleConfirmClear}
            icon={AlertOctagonIcon}
            danger
            title="Clear reading progress?"
            confirmText="Clear"
            loading={deleting}
          >
            This will remove <strong>{username}</strong>'s synced reading progress for{' '}
            <strong>{bookTitle}</strong>.
          </ConfirmModal>
        )}
        {showLinkModal && (
          <LinkProgressModal
            isOpen
            documentId={bookId}
            username={username}
            onClose={() => setShowLinkModal(false)}
          />
        )}
      </Fragment>
    );
  };
  ```

- [ ] **Step 2: Verify tests pass**

  ```bash
  cd app/client && npm test -- user-progress-row
  ```

  Expected: all tests pass. Toast assertions work via `ToastProvider` in the wrapper. No changes to the test file needed.

- [ ] **Step 3: Commit**

  ```bash
  git add app/client/src/component/user-progress-row/index.tsx
  git commit -m "refactor: migrate user-progress-row to useToast"
  ```

---

## Task 12: Migrate `reset-password-button`

**Files:**
- Modify: `app/client/src/control/reset-password-button/index.tsx`
- Check: `app/client/src/control/reset-password-button/index.test.tsx`

- [ ] **Step 1: Rewrite `reset-password-button/index.tsx`**

  ```tsx
  // app/client/src/control/reset-password-button/index.tsx
  import { Fragment, useCallback, useState } from 'react';

  import { useToast } from '~/provider/toast';
  import { useResetUserPassword } from '~/provider/user';

  import { Button } from '../button';
  import { ConfirmModal } from '../confirm-modal';
  import { PasswordResultModal } from '../password-result-modal';

  interface ResetPasswordButtonProps {
    username: string;
  }

  export const ResetPasswordButton = ({ username }: ResetPasswordButtonProps) => {
    const [resetUserPassword, resetting] = useResetUserPassword();
    const showToast = useToast();

    const [showConfirm, setShowConfirm] = useState(false);
    const [password, setPassword] = useState<string | null>(null);

    const showResult = password !== null;

    const handleClick = useCallback(() => setShowConfirm(true), []);
    const handleCancel = useCallback(() => setShowConfirm(false), []);
    const handleConfirm = useCallback(async () => {
      setShowConfirm(false);
      const newPassword = await resetUserPassword(username);
      if (newPassword === null) {
        showToast('Failed to reset password', 'error');
      } else {
        setPassword(newPassword);
      }
    }, [resetUserPassword, username, showToast]);
    const handleDone = useCallback(() => {
      setPassword(null);
    }, []);

    return (
      <Fragment>
        <Button type="link" onClick={handleClick} loading={resetting}>
          Reset password
        </Button>
        <ConfirmModal
          isOpen={showConfirm}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
          title={`Reset password for ${username}?`}
          confirmText="Reset password"
        >
          This generates a new login password and signs them in fresh — they&apos;ll be required to
          change it on their next login. The new password will be shown once; make sure to copy it
          before closing.
        </ConfirmModal>
        <PasswordResultModal
          isOpen={showResult}
          username={username}
          password={password}
          onDone={handleDone}
        />
      </Fragment>
    );
  };
  ```

- [ ] **Step 2: Verify tests pass**

  ```bash
  cd app/client && npm test -- reset-password-button
  ```

  Expected: both tests pass. The error toast test (`shows an error toast when the reset fails`) finds the toast text via `ToastProvider` in the wrapper. No changes to the test file needed.

- [ ] **Step 3: Commit**

  ```bash
  git add app/client/src/control/reset-password-button/index.tsx
  git commit -m "refactor: migrate reset-password-button to useToast"
  ```

---

## Task 13: Migrate `book-edit` and `login` pages

**Files:**
- Modify: `app/client/src/page/book-edit/index.tsx`
- Modify: `app/client/src/page/login/index.tsx`

Both pages currently hold a local error string and conditionally render `<Toast>`. After migration they call `showToast` in the error path and drop the local state.

- [ ] **Step 1: Rewrite `book-edit/index.tsx`**

  The `book-edit` page shows a toast when the book load fails. The error comes from the `useBook` hook; since it's not a user-triggered action (it's a page load), we show the toast via a `useEffect` that fires once when `errorMessage` first appears.

  ```tsx
  // app/client/src/page/book-edit/index.tsx
  import { useEffect } from 'react';
  import { useParams } from 'react-router-dom';

  import { BookEditForm, Page } from '~/component';
  import { useBook } from '~/provider/book';
  import { useToast } from '~/provider/toast';

  import { useStyle } from './style';

  export const BookEditPage = () => {
    const { id } = useParams<{ id: string }>();
    const styles = useStyle();
    const showToast = useToast();

    const [original, loading, hasError, errorMessage] = useBook(id!);

    useEffect(() => {
      if (errorMessage !== undefined) {
        showToast(errorMessage, 'error');
      }
    }, [errorMessage, showToast]);

    if (loading) {
      return (
        <Page>
          <h1 className={styles.heading}>Loading…</h1>
        </Page>
      );
    }

    if (!original) {
      return (
        <Page>
          <h1 className={styles.heading}>
            {hasError ? (errorMessage ?? 'Failed to load book.') : 'Book not found.'}
          </h1>
        </Page>
      );
    }

    return (
      <Page>
        <BookEditForm key={id} original={original} id={id!} />
      </Page>
    );
  };
  ```

  Note: `showToast` is stable (created with `useCallback` in the provider with stable deps), so including it in the deps array does not cause the effect to re-fire spuriously. This satisfies `react-hooks/exhaustive-deps` without any suppression.

- [ ] **Step 2: Rewrite `login/index.tsx`**

  ```tsx
  // app/client/src/page/login/index.tsx
  import { useCallback, useState } from 'react';

  import { Card, Page } from '~/component';
  import { Button, TextInput } from '~/control';
  import { BooksIcon } from '~/icon';
  import { useAuthRefresh } from '~/provider/auth';
  import { useToast } from '~/provider/toast';

  import { useStyle } from './style';

  export const LoginPage = () => {
    const styles = useStyle();
    const refetch = useAuthRefresh();
    const showToast = useToast();

    const [loading, setLoading] = useState<boolean>(false);
    const [username, setUsername] = useState<string | undefined>();
    const [password, setPassword] = useState<string | undefined>();

    const handleUsernameChange = useCallback((newUsername: string | undefined) => {
      setUsername(newUsername);
    }, []);

    const handlePasswordChange = useCallback((newPassword: string | undefined) => {
      setPassword(newPassword);
    }, []);

    const handleLogin = useCallback(async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ username: username ?? '', password: password ?? '' }),
        });
        if (response.ok) {
          await refetch();
        } else {
          showToast('Invalid credentials', 'error');
        }
      } catch {
        showToast('Network error — please try again', 'error');
      } finally {
        setLoading(false);
      }
    }, [username, password, refetch, showToast]);

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter') {
          event.stopPropagation();
          handleLogin();
        }
      },
      [handleLogin]
    );

    return (
      <Page type="minimal">
        <div className={styles.root}>
          <h1 className={styles.title}>
            <BooksIcon /> HASS-ODPS
          </h1>
          <Card className={styles.card}>
            <div className={styles.inputContainer}>
              <TextInput
                placeholder="Username"
                name="username"
                autoCapitalize="none"
                onChange={handleUsernameChange}
                value={username}
              />
              <TextInput
                placeholder="Password"
                name="password"
                onChange={handlePasswordChange}
                onKeyDown={handleKeyDown}
                password
                value={password}
              />
            </div>
            <Button loading={loading} type="primary" onClick={handleLogin}>
              Sign In
            </Button>
          </Card>
        </div>
      </Page>
    );
  };
  ```

- [ ] **Step 3: Run type check and tests**

  ```bash
  cd app/client && npm run type && npm test
  ```

  Expected: clean.

- [ ] **Step 4: Commit**

  ```bash
  git add app/client/src/page/book-edit/index.tsx app/client/src/page/login/index.tsx
  git commit -m "refactor: migrate book-edit and login pages to useToast"
  ```

---

## Task 14: Delete old `component/toast/` and clean up exports

**Files:**
- Delete: `app/client/src/component/toast/index.tsx`
- Delete: `app/client/src/component/toast/style.ts`
- Modify: `app/client/src/component/index.ts`

- [ ] **Step 1: Remove `Toast` from `component/index.ts`**

  Delete the line:

  ```ts
  export { Toast } from './toast';
  ```

- [ ] **Step 2: Delete the old Toast files**

  ```bash
  rm app/client/src/component/toast/index.tsx
  rm app/client/src/component/toast/style.ts
  rmdir app/client/src/component/toast
  ```

- [ ] **Step 3: Run type check**

  ```bash
  cd app/client && npm run type
  ```

  Expected: clean. No file should import `Toast` from `~/component` anymore.

- [ ] **Step 4: Run full test suite and lint**

  ```bash
  npm test && npm run lint
  ```

  Expected: all 361+ tests pass, lint clean.

- [ ] **Step 5: Commit**

  ```bash
  git add app/client/src/component/index.ts
  git add -A  # picks up the deletions
  git commit -m "refactor: remove old Toast component, all sites migrated to useToast"
  ```

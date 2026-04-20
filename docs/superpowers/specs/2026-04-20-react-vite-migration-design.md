# React + Vite Frontend Migration Design

**Date:** 2026-04-20
**Status:** Approved

## Overview

Migrate the existing monolithic `app/public/index.html` (~1150 lines of vanilla JS + inline CSS) to a React SPA built with Vite, styled with react-jss via a typed `ThemeProvider`, routed with React Router v6, and tested with Vitest.

The backend (Express + TypeScript + Jest) is untouched except for one file: `app/routes/ui.ts`, which is updated to serve the Vite build output instead of `app/public`.

---

## 1. Architecture & Package Layout

The frontend becomes a standalone package in `client/` alongside the existing `app/` backend.

```
HASS-ODPS/
├── app/                        # Express backend — untouched
│   └── public/                 # Superseded: Express will serve client/dist instead
├── client/                     # New: React + Vite SPA
│   ├── package.json            # Own deps: react, react-jss, react-router-dom, vite, vitest
│   ├── tsconfig.json           # target: esnext, jsx: react-jsx
│   ├── vite.config.ts          # Proxy /api/* and /logout → localhost:3000
│   ├── index.html              # Vite entry point
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── theme/
│       ├── auth/
│       ├── api/
│       └── components/
├── package.json                # Root: adds dev:client and build:client scripts
└── tsconfig.json               # Backend tsconfig — untouched
```

**Dev workflow:** `npm run dev:client` starts the Vite dev server on port 5173. `/api` and `/logout` requests are proxied to the Express backend on port 3000. No CORS configuration needed.

**Production:** `npm run build:client` runs `vite build` in `client/`, outputting to `client/dist/`. Express serves `client/dist` as static files with a catch-all for SPA navigation.

**Root `package.json` additions:**

```json
"dev:client":   "npm run --prefix client dev",
"build:client": "npm run --prefix client build",
"build":        "npm run build:client && tsc && ..."
```

---

## 2. Theme System

All visual tokens are defined once in `client/src/theme/` and consumed via a typed hook.

### `theme/theme.ts`

```ts
export interface Theme {
  colors: {
    primary: string;        // #1e40af
    primaryHover: string;   // #1d4ed8
    primaryLight: string;   // #eff6ff
    primaryBorder: string;  // #bfdbfe
    danger: string;         // #dc2626
    success: string;        // #16a34a
    text: {
      primary: string;      // #111
      secondary: string;    // #374151
      muted: string;        // #6b7280
      faint: string;        // #9ca3af
    };
    bg: {
      page: string;         // #f3f4f6
      card: string;         // #fff
      input: string;        // #fff
    };
    border: string;         // #d1d5db
    borderLight: string;    // #e5e7eb
  };
  borderRadius: {
    sm: string;   // 4px
    md: string;   // 6px
    lg: string;   // 8px
    pill: string; // 20px
  };
  shadows: {
    card: string;  // 0 1px 3px rgba(0,0,0,.07)
    cover: string; // 0 2px 8px rgba(0,0,0,.15)
  };
}

export const defaultTheme: Theme = { ... };
```

### `theme/theme-provider.tsx`

Wraps react-jss's `ThemeProvider` with the typed theme and exports a typed `useTheme` hook:

```tsx
import { ThemeProvider as JssThemeProvider, useTheme as useJssTheme } from 'react-jss';
import { defaultTheme, type Theme } from './theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <JssThemeProvider theme={defaultTheme}>{children}</JssThemeProvider>;
}

export function useTheme(): Theme {
  return useJssTheme<Theme>();
}
```

### `style.ts` pattern

Every component that needs styling exports a single `useStyle` hook via `makeStyles`. The return value is a `Record<string, string>` of JSS-generated class names, used like CSS Modules:

```ts
// components/header/style.ts
import { makeStyles } from 'react-jss';
import type { Theme } from '../../theme/theme';

const useStyle = makeStyles((theme: Theme) => ({
  root: {
    background: theme.colors.primary,
    color: '#fff',
    padding: '1rem 1.5rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  signOut: {
    '&:hover': { background: 'rgba(255,255,255,.1)' },
  },
}));

export { useStyle };
```

Used in the component as:

```tsx
const styles = useStyle();
return <header className={styles.root}>...</header>;
```

---

## 3. Authentication Context

`client/src/auth/auth-provider.tsx` fetches `/api/me` once on mount and provides user info via context. Not a route — wraps the entire app.

```ts
interface AuthContext {
  username: string;
  isAdmin: boolean;
}
```

Exported hook: `useAuth(): AuthContext`

On fetch failure, defaults to `{ username: '', isAdmin: false }` (same as current behaviour).

---

## 4. Routing

React Router v6 with `<BrowserRouter>` at the root. Routes map 1:1 to the existing custom router.

```tsx
// App.tsx
<BrowserRouter>
  <ThemeProvider>
    <AuthProvider>
      <Header />
      <Routes>
        <Route path="/"              element={<LibraryPage />} />
        <Route path="/series/:name"  element={<SeriesPage />} />
        <Route path="/books/:id"     element={<BookDetailPage />} />
        <Route path="/books/:id/edit" element={<EditMetadataPage />} />
        <Route path="*"              element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  </ThemeProvider>
</BrowserRouter>
```

- `<Header>` renders outside `<Routes>` — always visible.
- The **Users tab** is not a route. `LibraryPage` owns `activeTab: 'library' | 'users'` state and renders `<TabBar>` + either `<BookList>` or `<UsersPanel>`.
- `<EditMetadataPage>` checks `isAdmin` from `useAuth()` and redirects to `/` if not admin.
- Navigation uses `useNavigate()` in components.

---

## 5. Component Tree

All files use kebab-case. Components with styling have a `style.ts` sibling.

```
client/src/components/
├── header/
│   ├── index.tsx
│   └── style.ts
├── tab-bar/
│   ├── index.tsx
│   └── style.ts
├── library-page/
│   ├── index.tsx              # owns activeTab, cachedBooks, progressMap state
│   ├── style.ts
│   ├── upload-zone/
│   │   ├── index.tsx
│   │   └── style.ts
│   ├── book-list/
│   │   ├── index.tsx          # groupBooks logic lives here
│   │   └── style.ts
│   ├── series-row/
│   │   ├── index.tsx
│   │   └── style.ts
│   ├── standalone-section/
│   │   ├── index.tsx
│   │   └── style.ts
│   └── users-panel/
│       ├── index.tsx
│       ├── style.ts
│       ├── register-user-form/
│       │   ├── index.tsx
│       │   └── style.ts
│       └── user-row/
│           ├── index.tsx
│           └── style.ts
├── series-page/
│   ├── index.tsx
│   ├── style.ts
│   └── cover-stack/           # shared with series-row
│       ├── index.tsx
│       └── style.ts
├── book-detail-page/
│   ├── index.tsx
│   └── style.ts
├── edit-metadata-page/
│   ├── index.tsx
│   └── style.ts
└── shared/
    └── book-card/             # single book row used in standalone-section + series-page
        ├── index.tsx
        └── style.ts
```

**State ownership:**
- `currentUser` — `AuthProvider` context, accessed via `useAuth()`
- `cachedBooks` + `progressMap` — `LibraryPage` state, passed as props
- `activeTab` — `LibraryPage` local state
- Each page component owns its own loading/error state

**`cover-stack`** is defined under `series-page/` and imported by both `series-row` and `series-page`.

**All components use named exports** (e.g., `export function BookList`) — no default exports.

---

## 6. API Layer

`client/src/api/` contains typed fetch wrappers, one file per domain:

- `books.ts` — `getBooks()`, `getBook(id)`, `uploadBooks(files)`, `deleteBook(id)`, `patchBookMetadata(id, data)`, `scanLibrary()`
- `users.ts` — `getUsers()`, `getUserProgress(username)`, `deleteUser(username)`, `deleteUserProgress(username, docId)`, `registerUser(username, password)`
- `me.ts` — `getMe()`
- `progress.ts` — `getMyProgress()`, `deleteMyProgress(bookId)`

Each function returns a typed result or throws on non-ok responses. Components call these functions directly in `useEffect` hooks.

---

## 7. Testing

**Setup:** Vitest + React Testing Library + jsdom. `client/src/setup.ts` imports `@testing-library/jest-dom`. Tests live as `*.test.tsx` files alongside each component.

**Child component mocking:** Each component test mocks its direct children with `vi.mock()` so tests only assert on the component under test:

```tsx
// library-page/index.test.tsx
vi.mock('../tab-bar', () => ({ TabBar: () => <div data-testid="tab-bar" /> }));
vi.mock('./book-list', () => ({ BookList: () => <div data-testid="book-list" /> }));
vi.mock('./users-panel', () => ({ UsersPanel: () => <div data-testid="users-panel" /> }));
vi.mock('./upload-zone', () => ({ UploadZone: () => <div data-testid="upload-zone" /> }));
```

**`fetch` mocking:** `vi.fn()` per test file. No MSW.

**`style.ts` is never mocked** — `useStyle` always runs with a real theme so style regressions are caught.

**Test coverage targets:**

| Component | Test focus |
|---|---|
| `theme-provider` | `useTheme()` returns correct token values |
| `auth-provider` | fetches `/api/me`, provides `isAdmin`, handles failure |
| `header` | renders username, sign-out form present |
| `tab-bar` | renders correct tabs, active state |
| `library-page` | switches between Library/Users tabs |
| `upload-zone` | calls upload API on file drop, shows status |
| `book-list` | groups books into series + standalone correctly |
| `series-row` | renders series name, book count, navigates on click |
| `book-detail-page` | fetches book by id, renders fields, back nav |
| `edit-metadata-page` | redirects non-admin, saves changed fields only |
| `users-panel` | renders user list, toggles progress, delete |

---

## 8. Build Integration

### Vite proxy (`client/vite.config.ts`)

```ts
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/logout': 'http://localhost:3000',
    },
  },
  build: { outDir: 'dist' },  // outputs to client/dist/
});
```

### Express serving (`app/routes/ui.ts`)

The only backend file that changes. Replaces `app/public` with `client/dist`:

```ts
router.use(express.static(path.join(__dirname, '../../client/dist')));
router.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});
```

---

## 9. Migration Strategy

Single-pass replacement (Option C):

1. Scaffold `client/` package with Vite, React, react-jss, React Router, Vitest
2. Implement theme system and auth provider
3. Implement components one at a time, bottom-up (leaves first), using the existing `index.html` as the spec
4. Write tests alongside each component
5. Update `app/routes/ui.ts` to serve `client/dist`
6. Delete `app/public/index.html`
7. Verify end-to-end against the running Express backend

No new features are introduced during the migration. Feature parity with the existing `index.html` is the sole success criterion.

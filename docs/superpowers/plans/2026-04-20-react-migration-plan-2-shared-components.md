# React Migration — Plan 2: Shared Components

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the four leaf components — `cover-stack`, `shared/book-card`, `header`, and `tab-bar` — that all higher-level pages depend on.

**Architecture:** Each component is a named export in `index.tsx` with a `style.ts` sibling (except `cover-stack`, whose styles are entirely data-driven from props and use React inline styles). All tests use `renderWithProviders` from `client/src/test-utils.tsx`, which wraps with `MemoryRouter`, `ThemeProvider`, and `AuthContext.Provider`. Child mocking is not needed here — these are leaf components.

**Tech Stack:** React 18, react-jss 10, Vitest 2, React Testing Library 16, @testing-library/user-event 14

---

## Foundation (already in place from Plan 1)

- `client/src/types.ts` — `Book`, `CurrentUser`, etc. All `Book` string/number fields are **non-nullable**; `description` is optional (`description?: string`).
- `client/src/utils.ts` — `formatSize(bytes): string`, `relativeTime(timestamp): string`
- `client/src/theme/theme.ts` — `Theme` interface + `defaultTheme`
- `client/src/theme/theme-provider.tsx` — `ThemeProvider`, `useTheme()`
- `client/src/auth/auth-provider.tsx` — `AuthContext`, `AuthProvider`, `useAuth()` returning `AuthState` (`{username, isAdmin, loading}`)
- `client/src/test-utils.tsx` — `renderWithProviders(ui, { user? })` wraps with `MemoryRouter` + `ThemeProvider` + `AuthContext.Provider`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `client/src/components/series-page/cover-stack/index.tsx` | Create | Fanned book cover stack (inline styles, no style.ts) |
| `client/src/components/series-page/cover-stack/index.test.tsx` | Create | Tests for CoverStack |
| `client/src/components/shared/book-card/index.tsx` | Create | Single book row used in standalone-section + series-page |
| `client/src/components/shared/book-card/style.ts` | Create | JSS styles for BookCard |
| `client/src/components/shared/book-card/index.test.tsx` | Create | Tests for BookCard |
| `client/src/components/header/index.tsx` | Create | App header: title + username + sign-out |
| `client/src/components/header/style.ts` | Create | JSS styles for Header |
| `client/src/components/header/index.test.tsx` | Create | Tests for Header |
| `client/src/components/tab-bar/index.tsx` | Create | Library / Users tab bar |
| `client/src/components/tab-bar/style.ts` | Create | JSS styles for TabBar |
| `client/src/components/tab-bar/index.test.tsx` | Create | Tests for TabBar |

---

### Task 1: cover-stack

The fanned cover stack visual used by both `series-row` (Plan 3) and `series-page` (Plan 5). Styles are fully derived from props (position, size, rotation), so this component uses React `CSSProperties` inline styles — **no `style.ts`**.

**Files:**
- Create: `client/src/components/series-page/cover-stack/index.tsx`
- Create: `client/src/components/series-page/cover-stack/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/series-page/cover-stack/index.test.tsx`:

```tsx
import { renderWithProviders } from '../../../test-utils';
import { CoverStack, LIST_STACK_OFFSETS, HERO_STACK_OFFSETS } from './index';
import type { Book } from '../../../types';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'test-id',
    title: 'Test Book',
    author: 'Author',
    fileAs: 'Author',
    publisher: '',
    series: 'Test Series',
    seriesIndex: 1,
    subjects: [],
    identifiers: [],
    hasCover: false,
    size: 1000,
    addedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

it('renders container with correct pixel dimensions', () => {
  const { container } = renderWithProviders(
    <CoverStack
      books={[]}
      containerWidth={58}
      containerHeight={74}
      layerWidth={44}
      layerHeight={62}
      offsets={LIST_STACK_OFFSETS}
    />
  );
  const root = container.firstChild as HTMLElement;
  expect(root.style.width).toBe('58px');
  expect(root.style.height).toBe('74px');
});

it('renders an img with the cover URL for a book with hasCover=true', () => {
  const book = makeBook({ id: 'b1', hasCover: true });
  const { getByRole } = renderWithProviders(
    <CoverStack
      books={[book]}
      containerWidth={58}
      containerHeight={74}
      layerWidth={44}
      layerHeight={62}
      offsets={LIST_STACK_OFFSETS}
    />
  );
  expect(getByRole('img')).toHaveAttribute('src', '/api/books/b1/cover');
});

it('renders no img for a book without a cover', () => {
  const book = makeBook({ hasCover: false });
  const { container } = renderWithProviders(
    <CoverStack
      books={[book]}
      containerWidth={58}
      containerHeight={74}
      layerWidth={44}
      layerHeight={62}
      offsets={LIST_STACK_OFFSETS}
    />
  );
  expect(container.querySelectorAll('img')).toHaveLength(0);
});

it('gives ghost back layer opacity 0.3 and ghost middle layer 0.45', () => {
  const { container } = renderWithProviders(
    <CoverStack
      books={[]}
      containerWidth={58}
      containerHeight={74}
      layerWidth={44}
      layerHeight={62}
      offsets={LIST_STACK_OFFSETS}
    />
  );
  const layers = container.querySelectorAll<HTMLElement>('div > div');
  expect(layers[0].style.opacity).toBe('0.3');
  expect(layers[1].style.opacity).toBe('0.45');
});

it('exports LIST_STACK_OFFSETS and HERO_STACK_OFFSETS with 3 offsets each', () => {
  expect(LIST_STACK_OFFSETS).toHaveLength(3);
  expect(HERO_STACK_OFFSETS).toHaveLength(3);
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Create `client/src/components/series-page/cover-stack/index.tsx`**

```tsx
import type { Book } from '../../../types';

export interface StackOffset {
  left: number;
  top: number;
  rotate: string;
}

export const LIST_STACK_OFFSETS: StackOffset[] = [
  { left: 10, top: 5, rotate: '-6deg' },  // back
  { left: 5, top: 2, rotate: '-2deg' },   // middle
  { left: 0, top: 0, rotate: '0deg' },    // front
];

export const HERO_STACK_OFFSETS: StackOffset[] = [
  { left: 13, top: 6, rotate: '-6deg' },
  { left: 6, top: 3, rotate: '-2deg' },
  { left: 0, top: 0, rotate: '0deg' },
];

interface CoverStackProps {
  books: Book[];          // sorted ascending by seriesIndex; books[0] renders in front
  containerWidth: number;
  containerHeight: number;
  layerWidth: number;
  layerHeight: number;
  offsets: StackOffset[]; // [back, middle, front]
}

export function CoverStack({
  books,
  containerWidth,
  containerHeight,
  layerWidth,
  layerHeight,
  offsets,
}: CoverStackProps) {
  // offsets[0]=back → books[2], offsets[2]=front → books[0]
  const layers: (Book | null)[] = [
    books[2] ?? null,
    books[1] ?? null,
    books[0] ?? null,
  ];

  return (
    <div style={{ position: 'relative', width: containerWidth, height: containerHeight, flexShrink: 0 }}>
      {offsets.map((pos, i) => {
        const book = layers[i];
        const isGhost = !book;
        const opacity = isGhost ? (i === 0 ? 0.3 : 0.45) : 1;
        const base: React.CSSProperties = {
          position: 'absolute',
          left: pos.left,
          top: pos.top,
          width: layerWidth,
          height: layerHeight,
          borderRadius: 2,
          transform: `rotate(${pos.rotate})`,
          zIndex: i + 1,
          opacity,
          boxShadow: '1px 1px 3px rgba(0,0,0,.18)',
        };
        if (book?.hasCover) {
          return (
            <img
              key={i}
              src={`/api/books/${encodeURIComponent(book.id)}/cover`}
              alt=""
              style={{ ...base, objectFit: 'cover', display: 'block' }}
            />
          );
        }
        return <div key={i} style={{ ...base, background: '#d1d5db' }} />;
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: PASS — 5 new tests pass (17 total).

- [ ] **Step 5: Commit**

```bash
cd /Users/korzun/Code/HASS-ODPS
git add client/src/components/series-page/
git commit -m "feat: add CoverStack component with LIST and HERO stack offsets"
```

---

### Task 2: shared/book-card

Single book row used in `standalone-section` (Plan 3) and `series-page` (Plan 5). Receives `isAdmin` as a prop — does not call `useAuth()` itself.

**Files:**
- Create: `client/src/components/shared/book-card/style.ts`
- Create: `client/src/components/shared/book-card/index.tsx`
- Create: `client/src/components/shared/book-card/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/shared/book-card/index.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import { BookCard } from './index';
import type { Book } from '../../../types';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-1',
    title: 'Dune',
    author: 'Frank Herbert',
    fileAs: 'Herbert, Frank',
    publisher: 'Chilton',
    series: 'Dune',
    seriesIndex: 1,
    subjects: [],
    identifiers: [],
    hasCover: false,
    size: 1_048_576,
    addedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const noop = () => {};

it('renders the book title', () => {
  renderWithProviders(
    <BookCard book={makeBook()} progress={undefined} isAdmin={false}
      onDelete={noop} onClearProgress={noop} onClick={noop} />
  );
  expect(screen.getByText('Dune')).toBeInTheDocument();
});

it('shows a cover img when hasCover is true', () => {
  renderWithProviders(
    <BookCard book={makeBook({ id: 'b1', hasCover: true })} progress={undefined}
      isAdmin={false} onDelete={noop} onClearProgress={noop} onClick={noop} />
  );
  expect(screen.getByRole('img')).toHaveAttribute('src', '/api/books/b1/cover');
});

it('shows formatted file size', () => {
  renderWithProviders(
    <BookCard book={makeBook({ size: 1_048_576 })} progress={undefined}
      isAdmin={false} onDelete={noop} onClearProgress={noop} onClick={noop} />
  );
  expect(screen.getByText(/1\.0 MB/)).toBeInTheDocument();
});

it('shows progress percentage when provided', () => {
  renderWithProviders(
    <BookCard book={makeBook()} progress={0.75} isAdmin={false}
      onDelete={noop} onClearProgress={noop} onClick={noop} />
  );
  expect(screen.getByText('75%')).toBeInTheDocument();
});

it('does not show progress text when undefined', () => {
  renderWithProviders(
    <BookCard book={makeBook()} progress={undefined} isAdmin={false}
      onDelete={noop} onClearProgress={noop} onClick={noop} />
  );
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
});

it('shows delete button for admin', () => {
  renderWithProviders(
    <BookCard book={makeBook()} progress={undefined} isAdmin={true}
      onDelete={noop} onClearProgress={noop} onClick={noop} />
  );
  expect(screen.getByTitle('Delete')).toBeInTheDocument();
});

it('hides delete button for non-admin', () => {
  renderWithProviders(
    <BookCard book={makeBook()} progress={undefined} isAdmin={false}
      onDelete={noop} onClearProgress={noop} onClick={noop} />
  );
  expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
});

it('shows clear button for non-admin when progress exists', () => {
  renderWithProviders(
    <BookCard book={makeBook()} progress={0.5} isAdmin={false}
      onDelete={noop} onClearProgress={noop} onClick={noop} />
  );
  expect(screen.getByTitle('Clear reading status')).toBeInTheDocument();
});

it('hides clear button when no progress', () => {
  renderWithProviders(
    <BookCard book={makeBook()} progress={undefined} isAdmin={false}
      onDelete={noop} onClearProgress={noop} onClick={noop} />
  );
  expect(screen.queryByTitle('Clear reading status')).not.toBeInTheDocument();
});

it('calls onClick with book id when card is clicked', async () => {
  const user = userEvent.setup();
  const handleClick = vi.fn();
  renderWithProviders(
    <BookCard book={makeBook({ id: 'b2' })} progress={undefined} isAdmin={false}
      onDelete={noop} onClearProgress={noop} onClick={handleClick} />
  );
  await user.click(screen.getByText('Dune'));
  expect(handleClick).toHaveBeenCalledWith('b2');
});

it('calls onDelete and does not trigger onClick when delete button is clicked', async () => {
  const user = userEvent.setup();
  const handleDelete = vi.fn();
  const handleClick = vi.fn();
  renderWithProviders(
    <BookCard book={makeBook({ id: 'b3', title: 'Dune' })} progress={undefined}
      isAdmin={true} onDelete={handleDelete} onClearProgress={noop} onClick={handleClick} />
  );
  await user.click(screen.getByTitle('Delete'));
  expect(handleDelete).toHaveBeenCalledWith('b3', 'Dune');
  expect(handleClick).not.toHaveBeenCalled();
});

it('calls onClearProgress and does not trigger onClick when clear button is clicked', async () => {
  const user = userEvent.setup();
  const handleClear = vi.fn();
  const handleClick = vi.fn();
  renderWithProviders(
    <BookCard book={makeBook({ id: 'b4' })} progress={0.5} isAdmin={false}
      onDelete={noop} onClearProgress={handleClear} onClick={handleClick} />
  );
  await user.click(screen.getByTitle('Clear reading status'));
  expect(handleClear).toHaveBeenCalledWith('b4');
  expect(handleClick).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Create `client/src/components/shared/book-card/style.ts`**

```ts
import { makeStyles } from 'react-jss';
import type { Theme } from '../../../theme/theme';

const useStyle = makeStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '.75rem',
    background: theme.colors.bg.card,
    borderRadius: theme.borderRadius.md,
    padding: '.6rem .9rem',
    marginBottom: '.4rem',
    boxShadow: theme.shadows.card,
    cursor: 'pointer',
  },
  cover: { flexShrink: 0 },
  info: { flex: 1, minWidth: 0 },
  title: {
    fontWeight: 500,
    marginBottom: '.125rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    fontSize: '.75rem',
    color: theme.colors.text.muted,
    marginBottom: '.1rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  format: { fontSize: '.75rem', color: theme.colors.text.faint },
  progress: {
    fontSize: '.75rem',
    color: theme.colors.success,
    fontWeight: 500,
    marginRight: '.25rem',
    flexShrink: 0,
  },
  clearBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: theme.colors.text.faint,
    fontSize: '.75rem',
    padding: '.25rem .5rem',
    borderRadius: theme.borderRadius.sm,
    fontFamily: 'inherit',
    flexShrink: 0,
    '&:hover': { color: theme.colors.danger },
  },
  deleteBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: theme.colors.text.faint,
    fontSize: '1.1rem',
    padding: '.25rem .5rem',
    borderRadius: theme.borderRadius.sm,
    flexShrink: 0,
    '&:hover': { color: theme.colors.danger },
  },
}));

export { useStyle };
```

- [ ] **Step 4: Create `client/src/components/shared/book-card/index.tsx`**

```tsx
import { useStyle } from './style';
import { formatSize } from '../../../utils';
import type { Book } from '../../../types';

interface BookCardProps {
  book: Book;
  progress?: number;      // 0–1; undefined = no reading data
  isAdmin: boolean;
  compact?: boolean;      // true → 32×46px covers (series-page); false → 40×56px (standalone)
  onDelete: (id: string, title: string) => void;
  onClearProgress: (id: string) => void;
  onClick: (id: string) => void;
}

export function BookCard({
  book,
  progress,
  isAdmin,
  compact = false,
  onDelete,
  onClearProgress,
  onClick,
}: BookCardProps) {
  const styles = useStyle();
  const coverW = compact ? 32 : 40;
  const coverH = compact ? 46 : 56;

  return (
    <div className={styles.root} onClick={() => onClick(book.id)}>
      <div className={styles.cover}>
        {book.hasCover ? (
          <img
            src={`/api/books/${encodeURIComponent(book.id)}/cover`}
            alt={book.title}
            style={{ width: coverW, height: coverH, objectFit: 'cover', borderRadius: 2, display: 'block' }}
          />
        ) : (
          <div style={{ width: coverW, height: coverH, background: '#e0e0e0', borderRadius: 2 }} />
        )}
      </div>
      <div className={styles.info}>
        <div className={styles.title}>{book.title}</div>
        {book.author && <div className={styles.meta}>{book.author}</div>}
        <div className={styles.format}>
          {compact && book.seriesIndex > 0 ? `#${book.seriesIndex} · ` : ''}
          EPUB · {formatSize(book.size)}
        </div>
      </div>
      {progress != null && (
        <span className={styles.progress}>{Math.round(progress * 100)}%</span>
      )}
      {progress != null && !isAdmin && (
        <button
          type="button"
          className={styles.clearBtn}
          title="Clear reading status"
          onClick={e => { e.stopPropagation(); onClearProgress(book.id); }}
        >
          Clear
        </button>
      )}
      {isAdmin && (
        <button
          type="button"
          className={styles.deleteBtn}
          title="Delete"
          onClick={e => { e.stopPropagation(); onDelete(book.id, book.title); }}
        >
          🗑
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run — expect pass**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: PASS — 12 new tests pass (29 total).

- [ ] **Step 6: Commit**

```bash
cd /Users/korzun/Code/HASS-ODPS
git add client/src/components/shared/
git commit -m "feat: add BookCard component"
```

---

### Task 3: header

Top bar with app title, current username from auth context, and a native sign-out form (`POST /logout` — handled server-side, no JS needed).

**Files:**
- Create: `client/src/components/header/style.ts`
- Create: `client/src/components/header/index.tsx`
- Create: `client/src/components/header/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/header/index.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils';
import { Header } from './index';

it('renders the app title', () => {
  renderWithProviders(<Header />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('HASS-ODPS Library');
});

it('displays the username from auth context', () => {
  renderWithProviders(<Header />, { user: { username: 'alice', isAdmin: false } });
  expect(screen.getByText('alice')).toBeInTheDocument();
});

it('renders a sign-out form posting to /logout', () => {
  renderWithProviders(<Header />);
  const form = screen.getByRole('button', { name: 'Sign Out' }).closest('form')!;
  expect(form).toHaveAttribute('method', 'POST');
  expect(form).toHaveAttribute('action', '/logout');
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Create `client/src/components/header/style.ts`**

```ts
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
  title: { fontSize: '1.25rem' },
  actions: { display: 'flex', alignItems: 'center', gap: '.75rem' },
  username: { fontSize: '.875rem', opacity: 0.85 },
  signOut: {
    background: 'transparent',
    color: '#fff',
    border: '1px solid rgba(255,255,255,.5)',
    borderRadius: theme.borderRadius.sm,
    padding: '.375rem .75rem',
    cursor: 'pointer',
    fontSize: '.875rem',
    '&:hover': { background: 'rgba(255,255,255,.1)' },
  },
}));

export { useStyle };
```

- [ ] **Step 4: Create `client/src/components/header/index.tsx`**

```tsx
import { useAuth } from '../../auth/auth-provider';
import { useStyle } from './style';

export function Header() {
  const { username } = useAuth();
  const styles = useStyle();

  return (
    <header className={styles.root}>
      <h1 className={styles.title}>📚 HASS-ODPS Library</h1>
      <div className={styles.actions}>
        <span className={styles.username}>{username}</span>
        <form method="POST" action="/logout" style={{ margin: 0 }}>
          <button type="submit" className={styles.signOut}>Sign Out</button>
        </form>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Run — expect pass**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: PASS — 3 new tests pass (32 total).

- [ ] **Step 6: Commit**

```bash
cd /Users/korzun/Code/HASS-ODPS
git add client/src/components/header/
git commit -m "feat: add Header component"
```

---

### Task 4: tab-bar

Library / Users tab navigation. The Users tab is only shown to admins. Active tab styling uses a distinct JSS class rather than combining classes.

**Files:**
- Create: `client/src/components/tab-bar/style.ts`
- Create: `client/src/components/tab-bar/index.tsx`
- Create: `client/src/components/tab-bar/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/tab-bar/index.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils';
import { TabBar } from './index';

it('always renders the Library tab', () => {
  renderWithProviders(<TabBar active="library" onTabChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Library' })).toBeInTheDocument();
});

it('does not render the Users tab for non-admin', () => {
  renderWithProviders(
    <TabBar active="library" onTabChange={() => {}} />,
    { user: { username: 'alice', isAdmin: false } }
  );
  expect(screen.queryByRole('button', { name: 'Users' })).not.toBeInTheDocument();
});

it('renders the Users tab for admin', () => {
  renderWithProviders(
    <TabBar active="library" onTabChange={() => {}} />,
    { user: { username: 'admin', isAdmin: true } }
  );
  expect(screen.getByRole('button', { name: 'Users' })).toBeInTheDocument();
});

it('calls onTabChange with "users" when Users tab is clicked', async () => {
  const user = userEvent.setup();
  const handleChange = vi.fn();
  renderWithProviders(
    <TabBar active="library" onTabChange={handleChange} />,
    { user: { username: 'admin', isAdmin: true } }
  );
  await user.click(screen.getByRole('button', { name: 'Users' }));
  expect(handleChange).toHaveBeenCalledWith('users');
});

it('calls onTabChange with "library" when Library tab is clicked', async () => {
  const user = userEvent.setup();
  const handleChange = vi.fn();
  renderWithProviders(
    <TabBar active="users" onTabChange={handleChange} />,
    { user: { username: 'admin', isAdmin: true } }
  );
  await user.click(screen.getByRole('button', { name: 'Library' }));
  expect(handleChange).toHaveBeenCalledWith('library');
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Create `client/src/components/tab-bar/style.ts`**

```ts
import { makeStyles } from 'react-jss';
import type { Theme } from '../../theme/theme';

const useStyle = makeStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    borderBottom: `2px solid ${theme.colors.borderLight}`,
    marginBottom: '1.5rem',
  },
  tab: {
    background: 'transparent',
    border: 'none',
    padding: '.625rem 1.25rem',
    cursor: 'pointer',
    fontSize: '.9rem',
    color: theme.colors.text.muted,
    borderBottom: '2px solid transparent',
    marginBottom: -2,
    fontFamily: 'inherit',
    '&:hover': { color: theme.colors.text.secondary },
  },
  tabActive: {
    background: 'transparent',
    border: 'none',
    padding: '.625rem 1.25rem',
    cursor: 'pointer',
    fontSize: '.9rem',
    fontFamily: 'inherit',
    marginBottom: -2,
    color: theme.colors.primary,
    borderBottom: `2px solid ${theme.colors.primary}`,
    fontWeight: 500,
  },
}));

export { useStyle };
```

- [ ] **Step 4: Create `client/src/components/tab-bar/index.tsx`**

```tsx
import { useAuth } from '../../auth/auth-provider';
import { useStyle } from './style';

export type TabName = 'library' | 'users';

interface TabBarProps {
  active: TabName;
  onTabChange: (tab: TabName) => void;
}

export function TabBar({ active, onTabChange }: TabBarProps) {
  const { isAdmin } = useAuth();
  const styles = useStyle();

  return (
    <nav className={styles.root}>
      <button
        type="button"
        className={active === 'library' ? styles.tabActive : styles.tab}
        onClick={() => onTabChange('library')}
      >
        Library
      </button>
      {isAdmin && (
        <button
          type="button"
          className={active === 'users' ? styles.tabActive : styles.tab}
          onClick={() => onTabChange('users')}
        >
          Users
        </button>
      )}
    </nav>
  );
}
```

- [ ] **Step 5: Run — expect pass**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: PASS — 5 new tests pass (37 total).

- [ ] **Step 6: Commit**

```bash
cd /Users/korzun/Code/HASS-ODPS
git add client/src/components/tab-bar/
git commit -m "feat: add TabBar component"
```

---

## Plan 2 complete

All four leaf components are implemented and tested:
- `CoverStack` + offset constants exported for use by series-row and series-page
- `BookCard` with progress, delete (admin), clear (user) — 12 tests
- `Header` reading username from auth context — 3 tests
- `TabBar` with admin-gated Users tab — 5 tests

**Next:** Plan 3 — Library page (`upload-zone`, `series-row`, `standalone-section`, `book-list`, `library-page`)

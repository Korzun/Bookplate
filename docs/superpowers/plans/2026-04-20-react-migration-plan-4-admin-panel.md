# React Migration — Plan 4: Admin Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `UsersPanel` stub with three real components — `RegisterUserForm`, `UserRow`, and `UsersPanel` — giving admins a full user management interface.

**Architecture:** `UsersPanel` fetches the user list and owns reload logic. It renders `RegisterUserForm` at the top (which calls `onSuccess` to trigger a reload) and a `UserRow` per user. `UserRow` lazy-fetches each user's reading progress on first expand and caches it locally. `LibraryPage` is updated to pass its `books` state to `UsersPanel` so `UserRow` can resolve document IDs to book titles.

**Tech Stack:** React 18, react-jss 10 (`createUseStyles`), Vitest 2, React Testing Library 16, @testing-library/user-event 14

---

## Foundation (already in place from Plans 1–3)

- `client/src/types.ts` — `Book`, `User`, `Progress`
- `client/src/utils.ts` — `relativeTime(timestamp: number): string`
- `client/src/theme/theme.ts` — `Theme` interface + `defaultTheme`
- `client/src/theme/theme-provider.tsx` — `ThemeProvider`
- `client/src/auth/auth-provider.tsx` — `useAuth()`
- `client/src/test-utils.tsx` — `renderWithProviders(ui, { user? })`
- `client/src/api/users.ts` — `getUsers`, `getUserProgress`, `deleteUser`, `deleteUserProgress`, `registerUser`
- `client/src/components/library-page/index.tsx` — `LibraryPage` (renders `<UsersPanel />` on line 84 — will be updated)
- `client/src/components/library-page/users-panel/index.tsx` — stub (will be replaced)

**JSS convention:** `export const useStyle = createUseStyles((theme: Theme) => ({...}))` — use `export const` directly.

**Test runner:** Vitest 2 with `globals: true` — no need to import `it`, `expect`, `vi`, `describe`, `beforeEach`, `afterEach`.

**Test command:** `cd /Users/korzun/Code/HASS-ODPS/client && npm test`
**Lint command:** `cd /Users/korzun/Code/HASS-ODPS/client && npm run lint`

**Current test count:** 64 passing.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `client/src/components/library-page/users-panel/register-user-form/style.ts` | Create | JSS styles for RegisterUserForm |
| `client/src/components/library-page/users-panel/register-user-form/index.tsx` | Create | Username + password form, calls registerUser API |
| `client/src/components/library-page/users-panel/register-user-form/index.test.tsx` | Create | Tests for RegisterUserForm |
| `client/src/components/library-page/users-panel/user-row/style.ts` | Create | JSS styles for UserRow |
| `client/src/components/library-page/users-panel/user-row/index.tsx` | Create | Collapsible user row with lazy-loaded progress |
| `client/src/components/library-page/users-panel/user-row/index.test.tsx` | Create | Tests for UserRow |
| `client/src/components/library-page/users-panel/style.ts` | Create | JSS styles for UsersPanel |
| `client/src/components/library-page/users-panel/index.tsx` | Replace stub | Fetches users, renders RegisterUserForm + UserRow list |
| `client/src/components/library-page/users-panel/index.test.tsx` | Create | Tests for UsersPanel |
| `client/src/components/library-page/index.tsx` | Modify line 84 | Pass `books={books}` prop to `<UsersPanel />` |

---

### Task 1: register-user-form

Form that lets admins create new KOSync users. Shows inline status text. Calls `registerUser` from the API and fires `onSuccess` on success (so the parent can reload the user list). Does NOT use `useAuth()` — this component is always rendered inside an admin-only panel.

**Files:**
- Create: `client/src/components/library-page/users-panel/register-user-form/style.ts`
- Create: `client/src/components/library-page/users-panel/register-user-form/index.tsx`
- Create: `client/src/components/library-page/users-panel/register-user-form/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/library-page/users-panel/register-user-form/index.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../test-utils';
import { RegisterUserForm } from './index';
import { registerUser } from '../../../../api/users';

vi.mock('../../../../api/users', () => ({
  registerUser: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it('renders username input, password input, and register button', () => {
  renderWithProviders(<RegisterUserForm onSuccess={() => {}} />);
  expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument();
});

it('shows validation error when submitted with empty fields', async () => {
  const user = userEvent.setup();
  renderWithProviders(<RegisterUserForm onSuccess={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Register' }));
  expect(screen.getByText(/username and password are required/i)).toBeInTheDocument();
});

it('clears the form and calls onSuccess on successful registration', async () => {
  const u = userEvent.setup();
  vi.mocked(registerUser).mockResolvedValue(undefined);
  const onSuccess = vi.fn();
  renderWithProviders(<RegisterUserForm onSuccess={onSuccess} />);
  await u.type(screen.getByPlaceholderText('Username'), 'alice');
  await u.type(screen.getByPlaceholderText('Password'), 'secret');
  await u.click(screen.getByRole('button', { name: 'Register' }));
  await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  expect(screen.getByPlaceholderText('Username')).toHaveValue('');
  expect(screen.getByPlaceholderText('Password')).toHaveValue('');
});

it('shows "already taken" message when registerUser throws that error', async () => {
  const u = userEvent.setup();
  vi.mocked(registerUser).mockRejectedValue(new Error('Username already taken'));
  renderWithProviders(<RegisterUserForm onSuccess={() => {}} />);
  await u.type(screen.getByPlaceholderText('Username'), 'alice');
  await u.type(screen.getByPlaceholderText('Password'), 'secret');
  await u.click(screen.getByRole('button', { name: 'Register' }));
  await waitFor(() =>
    expect(screen.getByText(/username already taken/i)).toBeInTheDocument()
  );
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Create `client/src/components/library-page/users-panel/register-user-form/style.ts`**

```ts
import { createUseStyles } from 'react-jss';
import type { Theme } from '../../../../theme/theme';

const statusBase = { marginTop: '.4rem', fontSize: '.8rem', minHeight: '1rem' };

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    background: theme.colors.bg.card,
    borderRadius: theme.borderRadius.md,
    padding: '.75rem 1rem',
    marginBottom: '1rem',
    boxShadow: theme.shadows.card,
  },
  title: {
    fontSize: '.8rem',
    fontWeight: 600,
    color: theme.colors.text.secondary,
    marginBottom: '.5rem',
    textTransform: 'uppercase',
    letterSpacing: '.05em',
  },
  row: {
    display: 'flex',
    gap: '.5rem',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  input: {
    flex: 1,
    minWidth: 120,
    padding: '.4rem .6rem',
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.sm,
    fontSize: '.875rem',
    fontFamily: 'inherit',
    background: theme.colors.bg.input,
    color: theme.colors.text.primary,
  },
  btn: {
    background: theme.colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: theme.borderRadius.sm,
    padding: '.4rem .9rem',
    fontSize: '.875rem',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    '&:disabled': { opacity: 0.6, cursor: 'not-allowed' },
  },
  statusOk: { ...statusBase, color: theme.colors.success },
  statusErr: { ...statusBase, color: theme.colors.danger },
}));
```

- [ ] **Step 4: Create `client/src/components/library-page/users-panel/register-user-form/index.tsx`**

```tsx
import { useState } from 'react';
import { registerUser } from '../../../../api/users';
import { useStyle } from './style';

interface RegisterUserFormProps {
  onSuccess: () => void;
}

interface Status {
  text: string;
  ok: boolean;
}

export function RegisterUserForm({ onSuccess }: RegisterUserFormProps) {
  const styles = useStyle();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setStatus(null);
    if (!username.trim() || !password) {
      setStatus({ text: '✗ Username and password are required', ok: false });
      return;
    }
    setLoading(true);
    try {
      await registerUser(username.trim(), password);
      setStatus({ text: '✓ User registered', ok: true });
      setUsername('');
      setPassword('');
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      setStatus({ text: `✗ ${msg}`, ok: false });
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') void handleSubmit();
  }

  return (
    <div className={styles.root}>
      <div className={styles.title}>Register User</div>
      <div className={styles.row}>
        <input
          type="text"
          className={styles.input}
          placeholder="Username"
          autoComplete="off"
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <input
          type="password"
          className={styles.input}
          placeholder="Password"
          autoComplete="new-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={styles.btn}
          onClick={() => void handleSubmit()}
          disabled={loading}
        >
          {loading ? 'Registering…' : 'Register'}
        </button>
      </div>
      {status && (
        <div className={status.ok ? styles.statusOk : styles.statusErr}>
          {status.text}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run — expect pass**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: PASS — 4 new tests pass (68 total).

- [ ] **Step 6: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/korzun/Code/HASS-ODPS
git add client/src/components/library-page/users-panel/register-user-form/
git commit -m "feat: add RegisterUserForm component"
```

---

### Task 2: user-row

One row in the admin user list. Displays the username, sync count, and a delete button. Collapses/expands a reading progress list on click. Progress is lazy-loaded on first expand (cached locally afterwards). When a matching book is found in the `books` prop, shows the book title; otherwise shows the document ID. Delete and clear-progress actions use `confirm()` dialogs and call parent callbacks on success.

**Files:**
- Create: `client/src/components/library-page/users-panel/user-row/style.ts`
- Create: `client/src/components/library-page/users-panel/user-row/index.tsx`
- Create: `client/src/components/library-page/users-panel/user-row/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/library-page/users-panel/user-row/index.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../test-utils';
import { UserRow } from './index';
import type { Book, User } from '../../../../types';
import { getUserProgress, deleteUser } from '../../../../api/users';

vi.mock('../../../../api/users', () => ({
  getUserProgress: vi.fn(),
  deleteUser: vi.fn(),
  deleteUserProgress: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.clearAllMocks());

function makeUser(username: string, progressCount = 0): User {
  return { username, progressCount };
}

function makeBook(id: string, title: string): Book {
  return {
    id, title, author: 'Author', fileAs: 'Author', publisher: '',
    series: '', seriesIndex: 0, subjects: [], identifiers: [],
    hasCover: false, size: 1000, addedAt: '2024-01-01T00:00:00.000Z',
  };
}

const noop = () => {};

it('renders the username and progress count', () => {
  renderWithProviders(
    <UserRow user={makeUser('alice', 3)} books={[]} onDelete={noop} onProgressCleared={noop} />
  );
  expect(screen.getByText('alice')).toBeInTheDocument();
  expect(screen.getByText('3 synced')).toBeInTheDocument();
});

it('fetches and shows progress items when expanded', async () => {
  const u = userEvent.setup();
  vi.mocked(getUserProgress).mockResolvedValue([
    { document: 'doc-1', percentage: 0.5 },
  ]);
  renderWithProviders(
    <UserRow user={makeUser('alice')} books={[]} onDelete={noop} onProgressCleared={noop} />
  );
  await u.click(screen.getByText('alice'));
  await waitFor(() => expect(screen.getByText('doc-1')).toBeInTheDocument());
  expect(screen.getByText('50%')).toBeInTheDocument();
});

it('shows book title when a matching book is found in books prop', async () => {
  const u = userEvent.setup();
  vi.mocked(getUserProgress).mockResolvedValue([
    { document: 'epub-1', percentage: 0.75 },
  ]);
  const books = [makeBook('epub-1', 'Dune')];
  renderWithProviders(
    <UserRow user={makeUser('alice')} books={books} onDelete={noop} onProgressCleared={noop} />
  );
  await u.click(screen.getByText('alice'));
  await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
});

it('collapses the progress list when header is clicked a second time', async () => {
  const u = userEvent.setup();
  vi.mocked(getUserProgress).mockResolvedValue([]);
  renderWithProviders(
    <UserRow user={makeUser('alice')} books={[]} onDelete={noop} onProgressCleared={noop} />
  );
  await u.click(screen.getByText('alice'));
  await waitFor(() => expect(screen.getByText('No progress records.')).toBeInTheDocument());
  await u.click(screen.getByText('alice'));
  expect(screen.queryByText('No progress records.')).not.toBeInTheDocument();
});

it('calls onDelete after confirming user deletion', async () => {
  const u = userEvent.setup();
  vi.stubGlobal('confirm', () => true);
  vi.mocked(deleteUser).mockResolvedValue(undefined);
  const handleDelete = vi.fn();
  renderWithProviders(
    <UserRow user={makeUser('alice')} books={[]} onDelete={handleDelete} onProgressCleared={noop} />
  );
  await u.click(screen.getByRole('button', { name: /delete user alice/i }));
  await waitFor(() => expect(handleDelete).toHaveBeenCalledWith('alice'));
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Create `client/src/components/library-page/users-panel/user-row/style.ts`**

```ts
import { createUseStyles } from 'react-jss';
import type { Theme } from '../../../../theme/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    listStyle: 'none',
    background: theme.colors.bg.card,
    borderRadius: theme.borderRadius.md,
    boxShadow: theme.shadows.card,
    marginBottom: '.5rem',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '.5rem',
    padding: '.6rem .75rem',
    cursor: 'pointer',
    userSelect: 'none',
    '&:hover': { background: theme.colors.bg.page },
  },
  chevron: { fontSize: '.7rem', color: theme.colors.text.faint, flexShrink: 0 },
  name: { flex: 1, fontWeight: 500, color: theme.colors.text.primary },
  meta: { fontSize: '.8rem', color: theme.colors.text.muted },
  deleteBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0 .25rem',
    fontSize: '.875rem',
    color: theme.colors.text.faint,
    '&:hover': { color: theme.colors.danger },
  },
  progressList: {
    listStyle: 'none',
    padding: '.5rem .75rem',
    margin: 0,
    background: theme.colors.primaryLight,
    borderTop: `1px solid ${theme.colors.borderLight}`,
  },
  progressItem: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gridTemplateRows: 'auto auto',
    gap: '.25rem .5rem',
    alignItems: 'start',
    padding: '.4rem 0',
    borderBottom: `1px solid ${theme.colors.borderLight}`,
    '&:last-child': { borderBottom: 'none' },
  },
  progressEmpty: {
    color: theme.colors.text.muted,
    fontSize: '.875rem',
    padding: '.4rem 0',
  },
  progDoc: { fontSize: '.875rem', color: theme.colors.text.primary },
  progDocId: { display: 'block', fontSize: '.7rem', opacity: 0.5, fontFamily: 'monospace' },
  progPct: { fontSize: '.875rem', color: theme.colors.success, fontWeight: 500 },
  progMeta: { gridColumn: '1 / -1', fontSize: '.75rem', color: theme.colors.text.faint },
}));
```

- [ ] **Step 4: Create `client/src/components/library-page/users-panel/user-row/index.tsx`**

```tsx
import { useState } from 'react';
import { getUserProgress, deleteUser, deleteUserProgress } from '../../../../api/users';
import { relativeTime } from '../../../../utils';
import { useStyle } from './style';
import type { Book, Progress, User } from '../../../../types';

interface UserRowProps {
  user: User;
  books: Book[];
  onDelete: (username: string) => void;
  onProgressCleared: (username: string) => void;
}

export function UserRow({ user, books, onDelete, onProgressCleared }: UserRowProps) {
  const styles = useStyle();
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<Progress[] | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(false);

  async function handleToggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (progress === null) {
      setLoadingProgress(true);
      try {
        const data = await getUserProgress(user.username);
        setProgress(data);
      } catch {
        setProgress([]);
      } finally {
        setLoadingProgress(false);
      }
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete user "${user.username}" and all their reading progress?`)) return;
    try {
      await deleteUser(user.username);
      onDelete(user.username);
    } catch {
      alert('Failed to delete user.');
    }
  }

  async function handleClearProgress(docId: string) {
    const book = books.find(b => b.id === docId);
    const label = book ? book.title : docId;
    if (!confirm(`Clear progress for "${label}" for user "${user.username}"?`)) return;
    try {
      await deleteUserProgress(user.username, docId);
      setProgress(prev => prev ? prev.filter(p => p.document !== docId) : null);
      onProgressCleared(user.username);
    } catch {
      alert('Failed to clear progress.');
    }
  }

  function progressMeta(p: Progress): string {
    const parts: string[] = [];
    if (p.device) parts.push(p.device);
    if (p.timestamp != null) parts.push(relativeTime(p.timestamp));
    return parts.join(' · ');
  }

  return (
    <li className={styles.root}>
      <div
        className={styles.header}
        role="button"
        tabIndex={0}
        onClick={() => void handleToggle()}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void handleToggle();
          }
        }}
      >
        <span className={styles.chevron}>{open ? '▼' : '▶'}</span>
        <span className={styles.name}>{user.username}</span>
        <span className={styles.meta}>{user.progressCount} synced</span>
        <button
          type="button"
          className={styles.deleteBtn}
          onClick={e => { e.stopPropagation(); void handleDelete(); }}
          title="Delete user"
          aria-label={`Delete user ${user.username}`}
        >
          🗑
        </button>
      </div>
      {open && (
        <ul className={styles.progressList}>
          {loadingProgress ? (
            <li className={styles.progressEmpty}>Loading…</li>
          ) : progress && progress.length === 0 ? (
            <li className={styles.progressEmpty}>No progress records.</li>
          ) : (
            (progress ?? []).map(p => {
              const book = books.find(b => b.id === p.document);
              return (
                <li key={p.document} className={styles.progressItem}>
                  <span className={styles.progDoc}>
                    {book ? book.title : p.document}
                    {book && <small className={styles.progDocId}>{p.document}</small>}
                  </span>
                  <span className={styles.progPct}>{Math.round(p.percentage * 100)}%</span>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => void handleClearProgress(p.document)}
                    title="Clear progress"
                    aria-label={`Clear progress for ${book?.title ?? p.document}`}
                  >
                    🗑
                  </button>
                  <span className={styles.progMeta}>{progressMeta(p)}</span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </li>
  );
}
```

- [ ] **Step 5: Run — expect pass**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: PASS — 5 new tests pass (73 total).

- [ ] **Step 6: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/korzun/Code/HASS-ODPS
git add client/src/components/library-page/users-panel/user-row/
git commit -m "feat: add UserRow component with lazy progress loading"
```

---

### Task 3: users-panel + LibraryPage update

Replace the `UsersPanel` stub with the real implementation. `UsersPanel` fetches the user list on mount and re-fetches when `RegisterUserForm` reports success or when a user is deleted. It receives `books: Book[]` from `LibraryPage` and passes them to each `UserRow` so document IDs can be resolved to book titles. `LibraryPage` is updated to pass its `books` state to `<UsersPanel />`.

**Files:**
- Create: `client/src/components/library-page/users-panel/style.ts`
- Replace: `client/src/components/library-page/users-panel/index.tsx` (stub → real)
- Create: `client/src/components/library-page/users-panel/index.test.tsx`
- Modify: `client/src/components/library-page/index.tsx` line 84: `<UsersPanel />` → `<UsersPanel books={books} />`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/library-page/users-panel/index.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import { UsersPanel } from './index';
import { getUsers } from '../../../api/users';
import type { User } from '../../../types';

vi.mock('./register-user-form', () => ({
  RegisterUserForm: ({ onSuccess }: { onSuccess: () => void }) => (
    <button data-testid="reg-success" onClick={onSuccess} />
  ),
}));
vi.mock('./user-row', () => ({
  UserRow: ({ user }: { user: User }) => (
    <div data-testid="user-row" data-username={user.username} />
  ),
}));
vi.mock('../../../api/users', () => ({
  getUsers: vi.fn(),
  deleteUser: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUsers).mockResolvedValue([]);
});

it('shows loading state initially', () => {
  vi.mocked(getUsers).mockReturnValue(new Promise(() => {}));
  renderWithProviders(<UsersPanel books={[]} />);
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});

it('renders a UserRow per user after data loads', async () => {
  vi.mocked(getUsers).mockResolvedValue([
    { username: 'alice', progressCount: 2 },
    { username: 'bob', progressCount: 0 },
  ]);
  renderWithProviders(<UsersPanel books={[]} />);
  await waitFor(() => expect(screen.getAllByTestId('user-row')).toHaveLength(2));
});

it('shows empty state when no users are registered', async () => {
  vi.mocked(getUsers).mockResolvedValue([]);
  renderWithProviders(<UsersPanel books={[]} />);
  await waitFor(() => expect(screen.getByText(/no kosync users/i)).toBeInTheDocument());
});

it('re-fetches users when RegisterUserForm fires onSuccess', async () => {
  const u = userEvent.setup();
  vi.mocked(getUsers).mockResolvedValue([]);
  renderWithProviders(<UsersPanel books={[]} />);
  await waitFor(() => expect(screen.getByTestId('reg-success')).toBeInTheDocument());
  await u.click(screen.getByTestId('reg-success'));
  expect(vi.mocked(getUsers)).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: FAIL — tests fail because the stub `UsersPanel` doesn't match the new tests.

- [ ] **Step 3: Create `client/src/components/library-page/users-panel/style.ts`**

```ts
import { createUseStyles } from 'react-jss';
import type { Theme } from '../../../theme/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {},
  loading: {
    color: theme.colors.text.muted,
    textAlign: 'center',
    padding: '2rem',
  },
  empty: {
    color: theme.colors.text.muted,
    textAlign: 'center',
    padding: '1rem 0',
  },
  list: { listStyle: 'none', padding: 0, margin: 0 },
}));
```

- [ ] **Step 4: Replace `client/src/components/library-page/users-panel/index.tsx`**

Overwrite the stub with:

```tsx
import { useState, useEffect } from 'react';
import { getUsers, deleteUser } from '../../../api/users';
import { RegisterUserForm } from './register-user-form';
import { UserRow } from './user-row';
import { useStyle } from './style';
import type { Book, User } from '../../../types';

interface UsersPanelProps {
  books: Book[];
}

export function UsersPanel({ books }: UsersPanelProps) {
  const styles = useStyle();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadUsers() {
    try {
      const data = await getUsers();
      setUsers(data);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadUsers(); }, []);

  async function handleDelete(username: string) {
    try {
      await deleteUser(username);
      void loadUsers();
    } catch {
      alert('Failed to delete user.');
    }
  }

  function handleProgressCleared() {
    void loadUsers();
  }

  if (loading) return <p className={styles.loading}>Loading…</p>;

  return (
    <div className={styles.root}>
      <RegisterUserForm onSuccess={() => void loadUsers()} />
      {users.length === 0 ? (
        <p className={styles.empty}>No KOSync users registered yet.</p>
      ) : (
        <ul className={styles.list}>
          {users.map(u => (
            <UserRow
              key={u.username}
              user={u}
              books={books}
              onDelete={handleDelete}
              onProgressCleared={handleProgressCleared}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Update `client/src/components/library-page/index.tsx` line 84**

Change:
```tsx
        <UsersPanel />
```

To:
```tsx
        <UsersPanel books={books} />
```

- [ ] **Step 6: Run — expect pass**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: PASS — 4 new tests pass (77 total).

- [ ] **Step 7: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm run lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/korzun/Code/HASS-ODPS
git add client/src/components/library-page/users-panel/
git add client/src/components/library-page/index.tsx
git commit -m "feat: add UsersPanel replacing stub, pass books prop from LibraryPage"
```

---

## Plan 4 complete

All three admin panel components are implemented and tested:
- `RegisterUserForm` — username + password form with inline status, calls `registerUser` API (4 tests)
- `UserRow` — collapsible row with lazy-loaded progress, book title lookup, delete and clear-progress actions (5 tests)
- `UsersPanel` — fetches user list, renders RegisterUserForm + UserRow list, reloads on changes (4 tests)

**Total tests after Plan 4:** 77 passing

**Next:** Plan 5 — Detail pages + Express cutover (`series-page`, `book-detail-page`, `edit-metadata-page`, `App.tsx`, `main.tsx`, update `app/routes/ui.ts`, delete `app/public/index.html`)

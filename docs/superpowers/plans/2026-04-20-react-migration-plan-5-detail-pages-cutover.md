# Plan 5 — Detail Pages + Express Cutover

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement SeriesPage, BookDetailPage, EditMetadataPage, wire up App.tsx + main.tsx, and cut Express over to serve the Vite build output.

**Architecture:** Each page component fetches its own data via the existing API functions. `test-utils.tsx` gains an `initialEntries` option so tests can drive `useParams()` via MemoryRouter. The Express router gets a static-assets middleware for `/assets/*` (no auth) and `serveSpa` is updated to point to `client/dist/index.html`.

**Tech Stack:** React 18, React Router DOM v6, react-jss 10, Vitest 2, @testing-library/react, TypeScript 5.

---

## File Map

**Create:**
- `client/src/components/series-page/index.tsx` — SeriesPage: fetches books + progress, renders hero stack + reading-order list
- `client/src/components/series-page/style.ts` — SeriesPage styles
- `client/src/components/series-page/index.test.tsx` — 4 tests (81 total after this task)
- `client/src/components/book-detail-page/index.tsx` — BookDetailPage: fetches single book, shows cover/metadata
- `client/src/components/book-detail-page/style.ts` — BookDetailPage styles
- `client/src/components/book-detail-page/index.test.tsx` — 4 tests (85 total after this task)
- `client/src/components/edit-metadata-page/index.tsx` — EditMetadataPage: admin-only form, diff-saves only changed fields
- `client/src/components/edit-metadata-page/style.ts` — EditMetadataPage styles
- `client/src/components/edit-metadata-page/index.test.tsx` — 4 tests (89 total after this task)
- `client/src/App.tsx` — BrowserRouter + ThemeProvider + AuthProvider + all routes

**Modify:**
- `client/src/test-utils.tsx` — add `initialEntries?: string[]` option to `renderWithProviders`
- `client/src/main.tsx` — replace scaffold placeholder with `<App />`
- `app/routes/ui.ts` — add `/assets` static middleware; update `serveSpa` to `client/dist/index.html`; add `import express` default
- `package.json` — update `build` script to run `build:client` first and remove the `app/public` copy step

**Delete:**
- `app/public/index.html`

---

## Task 1: Update `test-utils.tsx` + `SeriesPage`

**Files:**
- Modify: `client/src/test-utils.tsx`
- Create: `client/src/components/series-page/style.ts`
- Create: `client/src/components/series-page/index.tsx`
- Test: `client/src/components/series-page/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/series-page/index.test.tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../../test-utils';
import { SeriesPage } from './index';
import type { Book } from '../../../types';
import { getBooks, deleteBook } from '../../../api/books';
import { getMyProgress } from '../../../api/progress';

vi.mock('../../../api/books', () => ({ getBooks: vi.fn(), deleteBook: vi.fn() }));
vi.mock('../../../api/progress', () => ({ getMyProgress: vi.fn(), deleteMyProgress: vi.fn() }));
vi.mock('./cover-stack', () => ({
  CoverStack: () => <div data-testid="cover-stack" />,
  HERO_STACK_OFFSETS: [],
}));
vi.mock('../shared/book-card', () => ({
  BookCard: ({ book, progress }: { book: Book; progress?: number }) => (
    <div data-testid="book-card">
      {book.title}
      {progress != null && <span>{Math.round(progress * 100)}%</span>}
    </div>
  ),
}));

beforeEach(() => vi.clearAllMocks());

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'b1', title: 'Dune', author: 'Frank Herbert', fileAs: 'Herbert, Frank',
    publisher: '', series: 'Dune', seriesIndex: 1, subjects: [], identifiers: [],
    hasCover: false, size: 1000, addedAt: '2024-01-01T00:00:00.000Z', ...overrides,
  };
}

function renderSeries(name = 'Dune') {
  return renderWithProviders(
    <Routes>
      <Route path="/series/:name" element={<SeriesPage />} />
      <Route path="/" element={<div data-testid="home" />} />
    </Routes>,
    { initialEntries: [`/series/${name}`] }
  );
}

it('renders series title and book count', async () => {
  vi.mocked(getBooks).mockResolvedValue([
    makeBook({ id: 'b1', seriesIndex: 1 }),
    makeBook({ id: 'b2', seriesIndex: 2 }),
  ]);
  vi.mocked(getMyProgress).mockResolvedValue([]);
  renderSeries();
  await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
  expect(screen.getByText(/2 books/)).toBeInTheDocument();
});

it('shows "Series not found." when no books match', async () => {
  vi.mocked(getBooks).mockResolvedValue([]);
  vi.mocked(getMyProgress).mockResolvedValue([]);
  renderSeries();
  await waitFor(() => expect(screen.getByText('Series not found.')).toBeInTheDocument());
});

it('navigates to / when back button is clicked', async () => {
  const user = userEvent.setup();
  vi.mocked(getBooks).mockResolvedValue([makeBook()]);
  vi.mocked(getMyProgress).mockResolvedValue([]);
  renderSeries();
  await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: /library/i }));
  expect(screen.getByTestId('home')).toBeInTheDocument();
});

it('shows progress percentage on book cards', async () => {
  vi.mocked(getBooks).mockResolvedValue([makeBook({ id: 'b1' })]);
  vi.mocked(getMyProgress).mockResolvedValue([{ document: 'b1', percentage: 0.75 }]);
  renderSeries();
  await waitFor(() => expect(screen.getByText('75%')).toBeInTheDocument());
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd client && npx vitest run src/components/series-page/index.test.tsx
```

Expected: FAIL — `SeriesPage` not found / `renderWithProviders` does not accept `initialEntries`

- [ ] **Step 3: Update `test-utils.tsx` to accept `initialEntries`**

```tsx
// client/src/test-utils.tsx
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from './theme/theme-provider';
import { AuthContext, type AuthState } from './auth/auth-provider';

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  user?: Omit<AuthState, 'loading'>;
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
  const authState: AuthState = { ...user, loading: false };

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <ThemeProvider>
          <AuthContext.Provider value={authState}>
            {children}
          </AuthContext.Provider>
        </ThemeProvider>
      </MemoryRouter>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
```

- [ ] **Step 4: Create `series-page/style.ts`**

```ts
// client/src/components/series-page/style.ts
import { createUseStyles } from 'react-jss';
import type { Theme } from '../../theme/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    maxWidth: 680,
    margin: '0 auto',
    padding: '1rem',
  },
  loading: {
    color: theme.colors.text.muted,
    padding: '2rem',
    textAlign: 'center',
  },
  notFound: {
    color: theme.colors.text.muted,
    padding: '2rem',
    textAlign: 'center',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: theme.colors.primary,
    cursor: 'pointer',
    fontSize: '0.875rem',
    padding: '0.25rem 0',
    marginBottom: '1.25rem',
    '&:hover': { color: theme.colors.primaryHover },
  },
  hero: {
    display: 'flex',
    gap: '1.25rem',
    alignItems: 'center',
    marginBottom: '2rem',
  },
  heroInfo: {},
  title: {
    margin: '0 0 0.375rem',
    fontSize: '1.5rem',
    fontWeight: 700,
    color: theme.colors.text.primary,
  },
  meta: {
    color: theme.colors.text.muted,
    fontSize: '0.875rem',
  },
  readingOrderLabel: {
    margin: '0 0 0.75rem',
    fontSize: '1rem',
    fontWeight: 600,
    color: theme.colors.text.secondary,
  },
  bookList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
}));
```

- [ ] **Step 5: Create `series-page/index.tsx`**

```tsx
// client/src/components/series-page/index.tsx
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getBooks, deleteBook } from '../../api/books';
import { getMyProgress, deleteMyProgress } from '../../api/progress';
import { useAuth } from '../../auth/auth-provider';
import { CoverStack, HERO_STACK_OFFSETS } from './cover-stack';
import { BookCard } from '../shared/book-card';
import { useStyle } from './style';
import type { Book } from '../../types';

export function SeriesPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const styles = useStyle();
  const [books, setBooks] = useState<Book[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [allBooks, progress] = await Promise.all([getBooks(), getMyProgress()]);
      const seriesBooks = allBooks
        .filter(b => b.series === name)
        .sort((a, b) => a.seriesIndex - b.seriesIndex);
      setBooks(seriesBooks);
      setProgressMap(new Map(progress.map(p => [p.document, p.percentage])));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className={styles.loading}>Loading…</p>;
  if (!name || books.length === 0) return <p className={styles.notFound}>Series not found.</p>;

  const author = books[0].author;

  async function handleDelete(id: string, title: string) {
    if (!confirm(`Delete "${title}"?`)) return;
    await deleteBook(id);
    void load();
  }

  async function handleClearProgress(id: string) {
    await deleteMyProgress(id);
    void load();
  }

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => navigate('/')}
        aria-label="Back to Library"
      >
        ← Library
      </button>
      <div className={styles.hero}>
        <CoverStack
          books={books}
          containerWidth={68}
          containerHeight={86}
          layerWidth={52}
          layerHeight={72}
          offsets={HERO_STACK_OFFSETS}
        />
        <div className={styles.heroInfo}>
          <h1 className={styles.title}>{name}</h1>
          <div className={styles.meta}>
            {author} · {books.length} book{books.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
      <h2 className={styles.readingOrderLabel}>Reading Order</h2>
      <div className={styles.bookList}>
        {books.map(book => (
          <BookCard
            key={book.id}
            book={book}
            progress={progressMap.get(book.id)}
            isAdmin={isAdmin}
            compact
            onDelete={(id, title) => void handleDelete(id, title)}
            onClearProgress={(id) => void handleClearProgress(id)}
            onClick={(id) => navigate(`/books/${encodeURIComponent(id)}`)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run tests and verify they pass**

```bash
cd client && npx vitest run src/components/series-page/index.test.tsx
```

Expected: 4 passed

- [ ] **Step 7: Run full test suite and lint**

```bash
cd client && npm test && npm run lint
```

Expected: 81 passed, 0 lint errors

- [ ] **Step 8: Commit**

```bash
cd client && git add src/test-utils.tsx src/components/series-page/
git commit -m "feat: add SeriesPage with hero stack, reading-order list, and progress map"
```

---

## Task 2: `BookDetailPage`

**Files:**
- Create: `client/src/components/book-detail-page/style.ts`
- Create: `client/src/components/book-detail-page/index.tsx`
- Test: `client/src/components/book-detail-page/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/book-detail-page/index.test.tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../../test-utils';
import { BookDetailPage } from './index';
import type { Book } from '../../../types';
import { getBook } from '../../../api/books';

vi.mock('../../../api/books', () => ({ getBook: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'b1', title: 'Dune', author: 'Frank Herbert', fileAs: 'Herbert, Frank',
    publisher: 'Chilton Books', series: '', seriesIndex: 0, subjects: ['Science Fiction'],
    identifiers: [{ scheme: 'isbn', value: '0-441-17271-7' }],
    hasCover: false, size: 1_200_000, addedAt: '2024-01-01T00:00:00.000Z',
    description: 'A desert planet epic.', ...overrides,
  };
}

function renderDetail(id = 'b1', isAdmin = false) {
  return renderWithProviders(
    <Routes>
      <Route path="/books/:id" element={<BookDetailPage />} />
      <Route path="/" element={<div data-testid="home" />} />
    </Routes>,
    { initialEntries: [`/books/${id}`], user: { username: isAdmin ? 'admin' : '', isAdmin } }
  );
}

it('shows book title and author after loading', async () => {
  vi.mocked(getBook).mockResolvedValue(makeBook());
  renderDetail();
  await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
  expect(screen.getByText('Frank Herbert')).toBeInTheDocument();
});

it('shows "Book not found." when API fails', async () => {
  vi.mocked(getBook).mockRejectedValue(new Error('not found'));
  renderDetail();
  await waitFor(() => expect(screen.getByText('Book not found.')).toBeInTheDocument());
});

it('shows series name when book belongs to a series', async () => {
  vi.mocked(getBook).mockResolvedValue(makeBook({ series: 'Dune', seriesIndex: 1 }));
  renderDetail();
  await waitFor(() => expect(screen.getByText(/Dune #1/)).toBeInTheDocument());
});

it('shows Edit Metadata button for admin only', async () => {
  vi.mocked(getBook).mockResolvedValue(makeBook());
  renderDetail('b1', false);
  await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /edit metadata/i })).not.toBeInTheDocument();

  vi.mocked(getBook).mockResolvedValue(makeBook());
  renderDetail('b1', true);
  await waitFor(() => expect(screen.getAllByText('Dune').length).toBeGreaterThan(0));
  expect(screen.getByRole('button', { name: /edit metadata/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd client && npx vitest run src/components/book-detail-page/index.test.tsx
```

Expected: FAIL — `BookDetailPage` not found

- [ ] **Step 3: Create `book-detail-page/style.ts`**

```ts
// client/src/components/book-detail-page/style.ts
import { createUseStyles } from 'react-jss';
import type { Theme } from '../../theme/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    maxWidth: 680,
    margin: '0 auto',
    padding: '1rem',
  },
  loading: {
    color: theme.colors.text.muted,
    padding: '2rem',
    textAlign: 'center',
  },
  notFound: {
    color: theme.colors.text.muted,
    padding: '2rem',
    textAlign: 'center',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: theme.colors.primary,
    cursor: 'pointer',
    fontSize: '0.875rem',
    padding: '0.25rem 0',
    marginBottom: '1.25rem',
    display: 'block',
    '&:hover': { color: theme.colors.primaryHover },
  },
  detail: {
    display: 'flex',
    gap: '1.25rem',
    alignItems: 'flex-start',
    marginBottom: '1.5rem',
  },
  coverPlaceholder: {
    width: 80,
    height: 114,
    background: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    flexShrink: 0,
  },
  coverImg: {
    flexShrink: 0,
    borderRadius: theme.borderRadius.sm,
    display: 'block',
    objectFit: 'cover',
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    margin: '0 0 0.25rem',
    fontSize: '1.25rem',
    fontWeight: 700,
    color: theme.colors.text.primary,
  },
  author: {
    color: theme.colors.text.secondary,
    marginBottom: '0.375rem',
  },
  series: {
    display: 'inline-block',
    padding: '0.125rem 0.5rem',
    background: theme.colors.primaryLight,
    color: theme.colors.primary,
    borderRadius: theme.borderRadius.pill,
    fontSize: '0.75rem',
    marginBottom: '0.5rem',
  },
  meta: {
    color: theme.colors.text.muted,
    fontSize: '0.875rem',
    marginBottom: '0.125rem',
  },
  editBtn: {
    marginTop: '0.75rem',
    padding: '0.375rem 0.75rem',
    background: theme.colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: theme.borderRadius.sm,
    cursor: 'pointer',
    fontSize: '0.875rem',
    '&:hover': { background: theme.colors.primaryHover },
  },
  description: {
    color: theme.colors.text.secondary,
    lineHeight: 1.6,
    marginBottom: '1rem',
    whiteSpace: 'pre-wrap',
  },
  subjects: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
    marginBottom: '1rem',
  },
  pill: {
    padding: '0.25rem 0.625rem',
    background: theme.colors.primaryLight,
    color: theme.colors.primary,
    borderRadius: theme.borderRadius.pill,
    fontSize: '0.75rem',
  },
  identifiers: {
    marginTop: '0.5rem',
  },
  identifier: {
    fontSize: '0.875rem',
    color: theme.colors.text.muted,
    marginBottom: '0.125rem',
  },
  scheme: {
    fontWeight: 600,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase',
    fontSize: '0.75rem',
  },
}));
```

- [ ] **Step 4: Create `book-detail-page/index.tsx`**

```tsx
// client/src/components/book-detail-page/index.tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getBook } from '../../api/books';
import { useAuth } from '../../auth/auth-provider';
import { formatSize } from '../../utils';
import { useStyle } from './style';
import type { Book } from '../../types';

export function BookDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const styles = useStyle();
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    getBook(id)
      .then(setBook)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className={styles.loading}>Loading…</p>;
  if (notFound || !book) return <p className={styles.notFound}>Book not found.</p>;

  const addedDate = new Date(book.addedAt).toLocaleDateString();

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => navigate(-1)}
      >
        ← Back
      </button>
      <div className={styles.detail}>
        {book.hasCover ? (
          <img
            className={styles.coverImg}
            src={`/api/books/${encodeURIComponent(book.id)}/cover`}
            alt={book.title}
            width={80}
            height={114}
          />
        ) : (
          <div className={styles.coverPlaceholder} />
        )}
        <div className={styles.info}>
          <h1 className={styles.title}>{book.title}</h1>
          {book.author.length > 0 && (
            <div className={styles.author}>{book.author}</div>
          )}
          {book.series.length > 0 && (
            <div className={styles.series}>
              {book.series}{book.seriesIndex > 0 ? ` #${book.seriesIndex}` : ''}
            </div>
          )}
          {book.publisher.length > 0 && (
            <div className={styles.meta}>{book.publisher}</div>
          )}
          <div className={styles.meta}>EPUB · {formatSize(book.size)}</div>
          <div className={styles.meta}>Added {addedDate}</div>
          {isAdmin && (
            <button
              type="button"
              className={styles.editBtn}
              onClick={() => navigate(`/books/${encodeURIComponent(book.id)}/edit`)}
            >
              Edit Metadata
            </button>
          )}
        </div>
      </div>
      {book.description && (
        <p className={styles.description}>{book.description}</p>
      )}
      {book.subjects.length > 0 && (
        <div className={styles.subjects}>
          {book.subjects.map(s => (
            <span key={s} className={styles.pill}>{s}</span>
          ))}
        </div>
      )}
      {book.identifiers.length > 0 && (
        <div className={styles.identifiers}>
          {book.identifiers.map(({ scheme, value }) => (
            <div key={scheme} className={styles.identifier}>
              <span className={styles.scheme}>{scheme}</span>: {value}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
cd client && npx vitest run src/components/book-detail-page/index.test.tsx
```

Expected: 4 passed

- [ ] **Step 6: Run full test suite and lint**

```bash
cd client && npm test && npm run lint
```

Expected: 85 passed, 0 lint errors

- [ ] **Step 7: Commit**

```bash
git add client/src/components/book-detail-page/
git commit -m "feat: add BookDetailPage with cover, metadata fields, and admin edit button"
```

---

## Task 3: `EditMetadataPage`

**Files:**
- Create: `client/src/components/edit-metadata-page/style.ts`
- Create: `client/src/components/edit-metadata-page/index.tsx`
- Test: `client/src/components/edit-metadata-page/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/edit-metadata-page/index.test.tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../../../test-utils';
import { EditMetadataPage } from './index';
import type { Book } from '../../../types';
import { getBook, patchBookMetadata } from '../../../api/books';

vi.mock('../../../api/books', () => ({ getBook: vi.fn(), patchBookMetadata: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'b1', title: 'Dune', author: 'Frank Herbert', fileAs: 'Herbert, Frank',
    publisher: 'Chilton Books', series: '', seriesIndex: 0,
    subjects: ['Science Fiction'], identifiers: [],
    hasCover: false, size: 1_000_000, addedAt: '2024-01-01T00:00:00.000Z',
    description: 'A desert planet.', ...overrides,
  };
}

function renderEdit(isAdmin = true) {
  return renderWithProviders(
    <Routes>
      <Route path="/books/:id/edit" element={<EditMetadataPage />} />
      <Route path="/books/:id" element={<div data-testid="detail" />} />
      <Route path="/" element={<div data-testid="home" />} />
    </Routes>,
    {
      initialEntries: ['/books/b1/edit'],
      user: { username: isAdmin ? 'admin' : '', isAdmin },
    }
  );
}

it('redirects to / when not admin', async () => {
  renderEdit(false);
  await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument());
});

it('renders form fields populated from book data', async () => {
  vi.mocked(getBook).mockResolvedValue(makeBook());
  renderEdit();
  await waitFor(() => expect(screen.getByDisplayValue('Dune')).toBeInTheDocument());
  expect(screen.getByDisplayValue('Frank Herbert')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Herbert, Frank')).toBeInTheDocument();
});

it('shows error message when save fails', async () => {
  const u = userEvent.setup();
  vi.mocked(getBook).mockResolvedValue(makeBook());
  vi.mocked(patchBookMetadata).mockRejectedValue(new Error('Server error'));
  renderEdit();
  await waitFor(() => expect(screen.getByDisplayValue('Dune')).toBeInTheDocument());
  await u.click(screen.getByRole('button', { name: /^save$/i }));
  await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument());
});

it('calls patchBookMetadata with only changed fields', async () => {
  const u = userEvent.setup();
  vi.mocked(getBook).mockResolvedValue(makeBook());
  vi.mocked(patchBookMetadata).mockResolvedValue(makeBook({ title: 'New Title' }));
  renderEdit();
  await waitFor(() => expect(screen.getByDisplayValue('Dune')).toBeInTheDocument());

  const titleInput = screen.getByDisplayValue('Dune');
  await u.clear(titleInput);
  await u.type(titleInput, 'New Title');

  await u.click(screen.getByRole('button', { name: /^save$/i }));

  await waitFor(() => expect(patchBookMetadata).toHaveBeenCalled());
  const fd = vi.mocked(patchBookMetadata).mock.calls[0][1] as FormData;
  expect(fd.get('title')).toBe('New Title');
  expect(fd.get('author')).toBeNull(); // unchanged — must not be sent
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd client && npx vitest run src/components/edit-metadata-page/index.test.tsx
```

Expected: FAIL — `EditMetadataPage` not found

- [ ] **Step 3: Create `edit-metadata-page/style.ts`**

```ts
// client/src/components/edit-metadata-page/style.ts
import { createUseStyles } from 'react-jss';
import type { Theme } from '../../theme/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    maxWidth: 680,
    margin: '0 auto',
    padding: '1rem',
  },
  loading: {
    color: theme.colors.text.muted,
    padding: '2rem',
    textAlign: 'center',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '1.5rem',
  },
  heading: {
    flex: 1,
    margin: 0,
    fontSize: '1.25rem',
    color: theme.colors.text.primary,
  },
  cancelBtn: {
    background: 'none',
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.sm,
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    padding: '0.375rem 0.75rem',
    fontSize: '0.875rem',
    '&:hover': { background: theme.colors.bg.page },
  },
  saveBtn: {
    background: theme.colors.primary,
    border: 'none',
    borderRadius: theme.borderRadius.sm,
    color: '#fff',
    cursor: 'pointer',
    padding: '0.375rem 0.75rem',
    fontSize: '0.875rem',
    '&:hover': { background: theme.colors.primaryHover },
    '&:disabled': { opacity: 0.6, cursor: 'default' },
  },
  error: {
    color: theme.colors.danger,
    fontSize: '0.875rem',
    marginBottom: '1rem',
  },
  form: {
    display: 'grid',
    gridTemplateColumns: '140px 1fr',
    gap: '0.75rem 1rem',
    alignItems: 'start',
  },
  label: {
    fontWeight: 600,
    fontSize: '0.875rem',
    color: theme.colors.text.secondary,
    paddingTop: '0.5rem',
  },
  input: {
    width: '100%',
    padding: '0.375rem 0.625rem',
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.sm,
    fontSize: '0.875rem',
    color: theme.colors.text.primary,
    background: theme.colors.bg.input,
    boxSizing: 'border-box',
    '&:focus': {
      outline: 'none',
      borderColor: theme.colors.primary,
    },
  },
  textarea: {
    width: '100%',
    padding: '0.375rem 0.625rem',
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.sm,
    fontSize: '0.875rem',
    color: theme.colors.text.primary,
    background: theme.colors.bg.input,
    boxSizing: 'border-box',
    resize: 'vertical',
    '&:focus': {
      outline: 'none',
      borderColor: theme.colors.primary,
    },
  },
  identifierSection: {
    gridColumn: '1 / -1',
  },
  identifierHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '0.5rem',
  },
  identifierRow: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '0.375rem',
    alignItems: 'center',
  },
  addBtn: {
    background: 'none',
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.sm,
    color: theme.colors.primary,
    cursor: 'pointer',
    fontSize: '0.8rem',
    padding: '0.125rem 0.5rem',
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: theme.colors.danger,
    cursor: 'pointer',
    fontSize: '1rem',
    padding: '0 0.25rem',
    flexShrink: 0,
  },
}));
```

- [ ] **Step 4: Create `edit-metadata-page/index.tsx`**

```tsx
// client/src/components/edit-metadata-page/index.tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { getBook, patchBookMetadata } from '../../api/books';
import { useAuth } from '../../auth/auth-provider';
import { useStyle } from './style';
import type { Book } from '../../types';

interface IdentifierRow {
  scheme: string;
  value: string;
}

export function EditMetadataPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const styles = useStyle();

  const [original, setOriginal] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [fileAs, setFileAs] = useState('');
  const [publisher, setPublisher] = useState('');
  const [series, setSeries] = useState('');
  const [seriesIndex, setSeriesIndex] = useState('');
  const [description, setDescription] = useState('');
  const [subjects, setSubjects] = useState('');
  const [identifiers, setIdentifiers] = useState<IdentifierRow[]>([]);
  const [cover, setCover] = useState<File | null>(null);

  useEffect(() => {
    if (!id || !isAdmin) { setLoading(false); return; }
    getBook(id)
      .then(book => {
        setOriginal(book);
        setTitle(book.title);
        setAuthor(book.author);
        setFileAs(book.fileAs);
        setPublisher(book.publisher);
        setSeries(book.series);
        setSeriesIndex(book.seriesIndex !== 0 ? String(book.seriesIndex) : '');
        setDescription(book.description ?? '');
        setSubjects(book.subjects.join(', '));
        setIdentifiers(book.identifiers);
      })
      .catch(() => setError('Failed to load book.'))
      .finally(() => setLoading(false));
  }, [id, isAdmin]);

  if (!isAdmin) return <Navigate to="/" replace />;
  if (loading) return <p className={styles.loading}>Loading…</p>;
  if (!original) return <p className={styles.error}>{error ?? 'Book not found.'}</p>;

  async function handleSave() {
    if (!original || !id) return;
    setSaving(true);
    setError(null);
    const trim = (s: string) => s.trim();
    try {
      const fd = new FormData();
      if (title.trim() !== original.title) fd.append('title', title.trim());
      if (author.trim() !== original.author) fd.append('author', author.trim());
      if (fileAs.trim() !== original.fileAs) fd.append('fileAs', fileAs.trim());
      if (publisher.trim() !== original.publisher) fd.append('publisher', publisher.trim());
      if (series.trim() !== original.series) fd.append('series', series.trim());
      const origIdx = original.seriesIndex !== 0 ? String(original.seriesIndex) : '';
      if (seriesIndex.trim() !== origIdx) fd.append('seriesIndex', seriesIndex.trim());
      if (description.trim() !== (original.description ?? '')) {
        fd.append('description', description.trim());
      }
      const newSubjects = subjects.split(',').map(trim).filter(Boolean);
      if (JSON.stringify(newSubjects) !== JSON.stringify(original.subjects)) {
        fd.append('subjects', JSON.stringify(newSubjects));
      }
      if (JSON.stringify(identifiers) !== JSON.stringify(original.identifiers)) {
        fd.append('identifiers', JSON.stringify(identifiers));
      }
      if (cover) fd.append('cover', cover);
      await patchBookMetadata(id, fd);
      navigate(`/books/${encodeURIComponent(id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function addIdentifier() {
    setIdentifiers(prev => [...prev, { scheme: '', value: '' }]);
  }

  function removeIdentifier(index: number) {
    setIdentifiers(prev => prev.filter((_, i) => i !== index));
  }

  function updateIdentifier(index: number, field: 'scheme' | 'value', val: string) {
    setIdentifiers(prev =>
      prev.map((row, i) => i === index ? { ...row, [field]: val } : row)
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.topBar}>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={() => navigate(`/books/${encodeURIComponent(id!)}`)}
        >
          Cancel
        </button>
        <h1 className={styles.heading}>Edit Metadata</h1>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.form}>
        <label className={styles.label}>Title</label>
        <input className={styles.input} value={title} onChange={e => setTitle(e.target.value)} />

        <label className={styles.label}>Author</label>
        <input className={styles.input} value={author} onChange={e => setAuthor(e.target.value)} />

        <label className={styles.label}>File As</label>
        <input className={styles.input} value={fileAs} onChange={e => setFileAs(e.target.value)} />

        <label className={styles.label}>Publisher</label>
        <input className={styles.input} value={publisher} onChange={e => setPublisher(e.target.value)} />

        <label className={styles.label}>Series</label>
        <input className={styles.input} value={series} onChange={e => setSeries(e.target.value)} />

        <label className={styles.label}>Series #</label>
        <input
          className={styles.input}
          type="number"
          value={seriesIndex}
          onChange={e => setSeriesIndex(e.target.value)}
        />

        <label className={styles.label}>Description</label>
        <textarea
          className={styles.textarea}
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={4}
        />

        <label className={styles.label}>Subjects</label>
        <input
          className={styles.input}
          value={subjects}
          onChange={e => setSubjects(e.target.value)}
          placeholder="comma-separated"
        />

        <label className={styles.label}>Cover Image</label>
        <input
          type="file"
          accept="image/*"
          onChange={e => setCover(e.target.files?.[0] ?? null)}
        />

        <div className={styles.identifierSection}>
          <div className={styles.identifierHeader}>
            <span className={styles.label}>Identifiers</span>
            <button type="button" className={styles.addBtn} onClick={addIdentifier}>
              + Add
            </button>
          </div>
          {identifiers.map((row, i) => (
            <div key={i} className={styles.identifierRow}>
              <input
                className={styles.input}
                placeholder="scheme (e.g. isbn)"
                value={row.scheme}
                onChange={e => updateIdentifier(i, 'scheme', e.target.value)}
              />
              <input
                className={styles.input}
                placeholder="value"
                value={row.value}
                onChange={e => updateIdentifier(i, 'value', e.target.value)}
              />
              <button
                type="button"
                className={styles.removeBtn}
                aria-label={`Remove identifier ${i + 1}`}
                onClick={() => removeIdentifier(i)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
cd client && npx vitest run src/components/edit-metadata-page/index.test.tsx
```

Expected: 4 passed

- [ ] **Step 6: Run full test suite and lint**

```bash
cd client && npm test && npm run lint
```

Expected: 89 passed, 0 lint errors

- [ ] **Step 7: Commit**

```bash
git add client/src/components/edit-metadata-page/
git commit -m "feat: add EditMetadataPage with diff-save, identifier rows, and admin guard"
```

---

## Task 4: `App.tsx` + update `main.tsx`

**Files:**
- Create: `client/src/App.tsx`
- Modify: `client/src/main.tsx`

No new tests. The existing 89 tests must still pass.

- [ ] **Step 1: Create `client/src/App.tsx`**

```tsx
// client/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './theme/theme-provider';
import { AuthProvider } from './auth/auth-provider';
import { Header } from './components/header';
import { LibraryPage } from './components/library-page';
import { SeriesPage } from './components/series-page';
import { BookDetailPage } from './components/book-detail-page';
import { EditMetadataPage } from './components/edit-metadata-page';

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Header />
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/series/:name" element={<SeriesPage />} />
            <Route path="/books/:id" element={<BookDetailPage />} />
            <Route path="/books/:id/edit" element={<EditMetadataPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 2: Update `client/src/main.tsx`**

```tsx
// client/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 3: Run full test suite and lint**

```bash
cd client && npm test && npm run lint
```

Expected: 89 passed, 0 lint errors

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx client/src/main.tsx
git commit -m "feat: wire up App.tsx with BrowserRouter and all routes, update main.tsx"
```

---

## Task 5: Express Cutover

**Files:**
- Modify: `app/routes/ui.ts` — static assets middleware + updated `serveSpa` path
- Modify: `package.json` — updated `build` script
- Delete: `app/public/index.html`

No new tests. The existing 89 client tests must still pass.

- [ ] **Step 1: Update `app/routes/ui.ts`**

Change the import line from:
```ts
import { Router, Request, Response } from 'express';
```
to:
```ts
import express, { Router, Request, Response } from 'express';
```

Replace the `serveSpa` definition and the comment above it (lines 147–154 in the current file):
```ts
// ── Protected ─────────────────────────────────────────

const serveSpa = (_req: Request, res: Response): void => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
};

router.get('/', sessionAuth, serveSpa);
```

with:
```ts
// ── Static assets (no auth required) ──────────────────
router.use('/assets', express.static(path.join(__dirname, '../../client/dist/assets')));

// ── Protected SPA ──────────────────────────────────────

const serveSpa = (_req: Request, res: Response): void => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
};

router.get('/', sessionAuth, serveSpa);
```

The `__dirname` at runtime is `dist/routes/` (after `tsc`) so `../../client/dist/` correctly resolves to the repo-root `client/dist/` directory.

- [ ] **Step 2: Update `build` script in `package.json`**

Replace:
```json
"build": "tsc && node -e \"const fs=require('fs');if(fs.existsSync('app/public'))fs.cpSync('app/public','dist/public',{recursive:true})\"",
```
with:
```json
"build": "npm run build:client && tsc",
```

This runs the Vite client build first (outputs to `client/dist/`), then compiles the backend. The old `app/public` copy step is removed — `client/dist/` is now the SPA source.

- [ ] **Step 3: Delete `app/public/index.html`**

```bash
rm app/public/index.html
```

If `app/public/` is now empty, also remove the directory:
```bash
rmdir app/public 2>/dev/null || true
```

- [ ] **Step 4: Run client tests and lint**

```bash
cd client && npm test && npm run lint
```

Expected: 89 passed, 0 lint errors

- [ ] **Step 5: Verify the backend still compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add app/routes/ui.ts package.json
git rm app/public/index.html
# If app/public/ is empty:
git rm -r app/public/ 2>/dev/null || true
git commit -m "feat: cut Express over to serve client/dist — delete app/public/index.html"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| SeriesPage with hero stack, reading-order list, progress | Task 1 |
| BookDetailPage with cover, metadata, admin edit button | Task 2 |
| EditMetadataPage admin-only, diff-saves, identifier rows | Task 3 |
| App.tsx wires all routes under BrowserRouter | Task 4 |
| main.tsx renders `<App />` | Task 4 |
| Express serves `client/dist/` instead of `app/public/` | Task 5 |
| `app/public/index.html` deleted | Task 5 |
| `build` script builds client then backend | Task 5 |

**Placeholder scan:** None found. All steps have complete code.

**Type consistency check:**
- `SeriesPage` uses `Book` from `../../types` ✓
- `BookDetailPage` uses `Book` from `../../types` ✓
- `EditMetadataPage` uses `Book`, `patchBookMetadata(id: string, data: FormData)` from `../../api/books` ✓
- `IdentifierRow` (`{ scheme: string; value: string }`) matches `Book.identifiers` type ✓
- `useStyle` in each `style.ts` is a named `export const` via `createUseStyles` ✓
- `initialEntries` in `test-utils.tsx` is passed to `MemoryRouter` which accepts `string[]` ✓
- `__dirname` path `../../client/dist/` correct for both dev (`app/routes/`) and prod (`dist/routes/`) ✓

# React Migration — Plan 3: Library Page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the five library-page components — `upload-zone`, `series-row`, `standalone-section`, `book-list`, and `library-page` — that together form the main view of the app.

**Architecture:** `LibraryPage` owns `books`, `progressMap`, and `activeTab` state. It fetches data on mount and passes it down as props. `BookList` receives books + progressMap, groups them with a local `groupBooks` function, and renders `SeriesRow` and `StandaloneSection`. Child component mocking (`vi.mock`) is used in every test file so each component is tested in isolation.

**Tech Stack:** React 18, react-jss 10 (`createUseStyles`), Vitest 2, React Testing Library 16, @testing-library/user-event 14

---

## Foundation (already in place from Plans 1 & 2)

- `client/src/types.ts` — `Book`, `Progress`, `ScanResult`, `UploadResult`
- `client/src/utils.ts` — `formatSize(bytes): string`
- `client/src/theme/theme.ts` — `Theme` interface + `defaultTheme`
- `client/src/theme/theme-provider.tsx` — `ThemeProvider`
- `client/src/auth/auth-provider.tsx` — `useAuth()` → `{ username, isAdmin, loading }`
- `client/src/test-utils.tsx` — `renderWithProviders(ui, { user? })`
- `client/src/api/books.ts` — `getBooks`, `deleteBook`, `uploadBooks`, `scanLibrary`
- `client/src/api/progress.ts` — `getMyProgress`, `deleteMyProgress`
- `client/src/components/tab-bar/index.tsx` — `TabBar`, `TabName`
- `client/src/components/series-page/cover-stack/index.tsx` — `CoverStack`, `LIST_STACK_OFFSETS`, `StackOffset`
- `client/src/components/shared/book-card/index.tsx` — `BookCard`

**JSS convention:** `export const useStyle = createUseStyles((theme: Theme) => ({...}))` — use `export const` directly, no separate `export { useStyle }`.

**Test runner:** Vitest 2 with `globals: true` — no need to import `it`, `expect`, `vi`, `describe`.

**Test command:** `cd /Users/korzun/Code/HASS-ODPS/client && npm test`
**Lint command:** `cd /Users/korzun/Code/HASS-ODPS/client && npm run lint`

**Current test count:** 38 passing.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `client/src/components/library-page/upload-zone/index.tsx` | Create | Drop zone + scan button |
| `client/src/components/library-page/upload-zone/style.ts` | Create | JSS styles for UploadZone |
| `client/src/components/library-page/upload-zone/index.test.tsx` | Create | Tests for UploadZone |
| `client/src/components/library-page/series-row/index.tsx` | Create | One series entry in the book list |
| `client/src/components/library-page/series-row/style.ts` | Create | JSS styles for SeriesRow |
| `client/src/components/library-page/series-row/index.test.tsx` | Create | Tests for SeriesRow |
| `client/src/components/library-page/standalone-section/index.tsx` | Create | Collapsible standalone books section |
| `client/src/components/library-page/standalone-section/style.ts` | Create | JSS styles for StandaloneSection |
| `client/src/components/library-page/standalone-section/index.test.tsx` | Create | Tests for StandaloneSection |
| `client/src/components/library-page/book-list/index.tsx` | Create | Groups + renders books; owns groupBooks |
| `client/src/components/library-page/book-list/style.ts` | Create | JSS styles for BookList |
| `client/src/components/library-page/book-list/index.test.tsx` | Create | Tests for BookList |
| `client/src/components/library-page/users-panel/index.tsx` | Create | Stub — Plan 4 replaces this |
| `client/src/components/library-page/index.tsx` | Create | Owns state, fetches data, tab switching |
| `client/src/components/library-page/style.ts` | Create | JSS styles for LibraryPage |
| `client/src/components/library-page/index.test.tsx` | Create | Tests for LibraryPage |

---

### Task 1: upload-zone

Drop zone for EPUB files (drag-and-drop + click). Admin-only "Scan Library" button above it. Calls `uploadBooks` / `scanLibrary` from the API layer; shows inline status text. Does **not** call `useAuth()` — `isAdmin` comes from props.

**Files:**
- Create: `client/src/components/library-page/upload-zone/style.ts`
- Create: `client/src/components/library-page/upload-zone/index.tsx`
- Create: `client/src/components/library-page/upload-zone/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/library-page/upload-zone/index.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import { UploadZone } from './index';
import { uploadBooks, scanLibrary } from '../../../api/books';

vi.mock('../../../api/books', () => ({
  uploadBooks: vi.fn(),
  scanLibrary: vi.fn(),
}));

const noop = () => Promise.resolve();

it('renders drop zone text', () => {
  renderWithProviders(<UploadZone isAdmin={false} onUploadComplete={noop} onScanComplete={noop} />);
  expect(screen.getByText(/drop books here/i)).toBeInTheDocument();
});

it('shows scan button for admin', () => {
  renderWithProviders(<UploadZone isAdmin={true} onUploadComplete={noop} onScanComplete={noop} />);
  expect(screen.getByRole('button', { name: 'Scan Library' })).toBeInTheDocument();
});

it('hides scan button for non-admin', () => {
  renderWithProviders(<UploadZone isAdmin={false} onUploadComplete={noop} onScanComplete={noop} />);
  expect(screen.queryByRole('button', { name: 'Scan Library' })).not.toBeInTheDocument();
});

it('shows success status after upload', async () => {
  const user = userEvent.setup();
  vi.mocked(uploadBooks).mockResolvedValue({ uploaded: ['test.epub'] });
  const onUploadComplete = vi.fn();
  renderWithProviders(
    <UploadZone isAdmin={false} onUploadComplete={onUploadComplete} onScanComplete={noop} />
  );
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['epub'], 'test.epub', { type: 'application/epub+zip' });
  await user.upload(input, file);
  await waitFor(() => expect(screen.getByText(/uploaded.*test\.epub/i)).toBeInTheDocument());
  expect(onUploadComplete).toHaveBeenCalled();
});

it('shows error status when upload fails', async () => {
  const user = userEvent.setup();
  vi.mocked(uploadBooks).mockRejectedValue(new Error('Upload failed'));
  renderWithProviders(<UploadZone isAdmin={false} onUploadComplete={noop} onScanComplete={noop} />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['epub'], 'test.epub', { type: 'application/epub+zip' });
  await user.upload(input, file);
  await waitFor(() => expect(screen.getByText(/upload failed/i)).toBeInTheDocument());
});

it('calls scanLibrary and shows success on scan click', async () => {
  const user = userEvent.setup();
  vi.mocked(scanLibrary).mockResolvedValue({ imported: ['a.epub'], removed: [] });
  const onScanComplete = vi.fn();
  renderWithProviders(
    <UploadZone isAdmin={true} onUploadComplete={noop} onScanComplete={onScanComplete} />
  );
  await user.click(screen.getByRole('button', { name: 'Scan Library' }));
  await waitFor(() => expect(screen.getByText(/scan complete/i)).toBeInTheDocument());
  expect(onScanComplete).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Create `client/src/components/library-page/upload-zone/style.ts`**

```ts
import { createUseStyles } from 'react-jss';
import type { Theme } from '../../../theme/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  scanRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '.75rem',
    marginBottom: '1rem',
  },
  scanBtn: {
    background: theme.colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: theme.borderRadius.sm,
    padding: '.5rem 1rem',
    fontSize: '.875rem',
    cursor: 'pointer',
    fontFamily: 'inherit',
    '&:hover:not(:disabled)': { background: theme.colors.primaryHover },
    '&:disabled': { opacity: 0.6, cursor: 'not-allowed' },
  },
  dropZone: {
    border: `2px dashed ${theme.colors.primaryBorder}`,
    borderRadius: theme.borderRadius.lg,
    padding: '2rem',
    textAlign: 'center',
    cursor: 'pointer',
    background: theme.colors.primaryLight,
    marginBottom: '2rem',
    transition: 'background .15s',
  },
  dropZoneOver: {
    border: '2px dashed #3b82f6',
    borderRadius: theme.borderRadius.lg,
    padding: '2rem',
    textAlign: 'center',
    cursor: 'pointer',
    background: '#dbeafe',
    marginBottom: '2rem',
    transition: 'background .15s',
  },
  dropText: { color: theme.colors.primaryHover, marginBottom: '.5rem' },
  dropSmall: { color: theme.colors.text.muted },
  statusOk: { color: theme.colors.success, fontSize: '.875rem' },
  statusErr: { color: theme.colors.danger, fontSize: '.875rem' },
}));
```

- [ ] **Step 4: Create `client/src/components/library-page/upload-zone/index.tsx`**

```tsx
import { useState, useRef } from 'react';
import { uploadBooks, scanLibrary } from '../../../api/books';
import { useStyle } from './style';

interface UploadZoneProps {
  isAdmin: boolean;
  onUploadComplete: () => void;
  onScanComplete: () => void;
}

interface Status {
  text: string;
  ok: boolean;
}

export function UploadZone({ isAdmin, onUploadComplete, onScanComplete }: UploadZoneProps) {
  const styles = useStyle();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<Status | null>(null);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<Status | null>(null);

  async function handleFiles(files: FileList) {
    if (!files.length) return;
    setUploading(true);
    setUploadStatus({ text: `Uploading ${files.length} file(s)…`, ok: true });
    try {
      const result = await uploadBooks(files);
      setUploadStatus({ text: `✓ Uploaded: ${result.uploaded.join(', ')}`, ok: true });
      onUploadComplete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setUploadStatus({ text: `✗ ${msg}`, ok: false });
    } finally {
      setUploading(false);
    }
  }

  async function handleScan() {
    setScanning(true);
    setScanStatus(null);
    try {
      const result = await scanLibrary();
      const total = result.imported.length + result.removed.length;
      setScanStatus({
        text: total === 0
          ? '✓ Library already up to date'
          : `✓ Scan complete: ${result.imported.length} imported, ${result.removed.length} removed`,
        ok: true,
      });
      onScanComplete();
    } catch {
      setScanStatus({ text: '✗ Scan failed', ok: false });
    } finally {
      setScanning(false);
    }
  }

  return (
    <div>
      {isAdmin && (
        <div className={styles.scanRow}>
          <button
            type="button"
            className={styles.scanBtn}
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning ? 'Scanning…' : 'Scan Library'}
          </button>
          {scanStatus && (
            <span className={scanStatus.ok ? styles.statusOk : styles.statusErr}>
              {scanStatus.text}
            </span>
          )}
        </div>
      )}
      <div
        className={dragOver ? styles.dropZoneOver : styles.dropZone}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          id="upload-file-input"
          type="file"
          accept=".epub"
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <p className={styles.dropText}>
          Drop books here or{' '}
          <label htmlFor="upload-file-input" style={{ textDecoration: 'underline', cursor: 'pointer' }}>
            click to upload
          </label>
        </p>
        <small className={styles.dropSmall}>Supported format: epub</small>
        {uploadStatus && (
          <div className={uploadStatus.ok ? styles.statusOk : styles.statusErr}>
            {uploadStatus.text}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run — expect pass**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: PASS — 6 new tests pass (44 total).

- [ ] **Step 6: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/korzun/Code/HASS-ODPS
git add client/src/components/library-page/upload-zone/
git commit -m "feat: add UploadZone component"
```

---

### Task 2: series-row

One row in the library book list representing a series. Shows a `CoverStack`, series name, author, book count, and average progress. Navigates via the `onClick` prop (parent is responsible for calling `navigate`). Mocks `CoverStack` in tests.

**Files:**
- Create: `client/src/components/library-page/series-row/style.ts`
- Create: `client/src/components/library-page/series-row/index.tsx`
- Create: `client/src/components/library-page/series-row/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/library-page/series-row/index.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import { SeriesRow } from './index';
import type { Book } from '../../../types';

vi.mock('../../series-page/cover-stack', () => ({
  CoverStack: () => <div data-testid="cover-stack" />,
  LIST_STACK_OFFSETS: [],
}));

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'b1',
    title: 'Dune',
    author: 'Frank Herbert',
    fileAs: 'Herbert, Frank',
    publisher: '',
    series: 'Dune',
    seriesIndex: 1,
    subjects: [],
    identifiers: [],
    hasCover: false,
    size: 1000,
    addedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const books = [makeBook({ id: 'b1', seriesIndex: 1 }), makeBook({ id: 'b2', seriesIndex: 2 })];

it('renders the series name', () => {
  renderWithProviders(
    <SeriesRow seriesName="Dune" books={books} progressMap={new Map()} onClick={() => {}} />
  );
  expect(screen.getByText('Dune')).toBeInTheDocument();
});

it('renders the author from the first book', () => {
  renderWithProviders(
    <SeriesRow seriesName="Dune" books={books} progressMap={new Map()} onClick={() => {}} />
  );
  expect(screen.getByText(/Frank Herbert/)).toBeInTheDocument();
});

it('renders the book count', () => {
  renderWithProviders(
    <SeriesRow seriesName="Dune" books={books} progressMap={new Map()} onClick={() => {}} />
  );
  expect(screen.getByText(/2 books/)).toBeInTheDocument();
});

it('shows average progress percentage when progressMap has entries for series books', () => {
  const progressMap = new Map([['b1', 1.0], ['b2', 0.5]]);
  renderWithProviders(
    <SeriesRow seriesName="Dune" books={books} progressMap={progressMap} onClick={() => {}} />
  );
  // avg = (1.0 + 0.5) / 2 = 0.75 → 75%
  expect(screen.getByText(/75%/)).toBeInTheDocument();
});

it('calls onClick with series name when clicked', async () => {
  const user = userEvent.setup();
  const handleClick = vi.fn();
  renderWithProviders(
    <SeriesRow seriesName="Dune" books={books} progressMap={new Map()} onClick={handleClick} />
  );
  await user.click(screen.getByText('Dune'));
  expect(handleClick).toHaveBeenCalledWith('Dune');
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Create `client/src/components/library-page/series-row/style.ts`**

```ts
import { createUseStyles } from 'react-jss';
import type { Theme } from '../../../theme/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    background: theme.colors.bg.card,
    borderRadius: theme.borderRadius.md,
    padding: '.75rem 1rem',
    marginBottom: '.5rem',
    display: 'flex',
    alignItems: 'center',
    gap: '.9rem',
    boxShadow: theme.shadows.card,
    cursor: 'pointer',
    border: '1px solid transparent',
    '&:hover': { borderColor: theme.colors.primaryBorder },
  },
  info: { flex: 1, minWidth: 0 },
  name: {
    fontWeight: 600,
    fontSize: '.92rem',
    color: theme.colors.text.primary,
    marginBottom: '.15rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    fontSize: '.75rem',
    color: theme.colors.text.muted,
    marginBottom: '.1rem',
  },
  progress: {
    color: theme.colors.success,
    fontWeight: 500,
  },
  link: {
    fontSize: '.7rem',
    color: theme.colors.primary,
    fontWeight: 500,
  },
}));
```

- [ ] **Step 4: Create `client/src/components/library-page/series-row/index.tsx`**

```tsx
import { CoverStack, LIST_STACK_OFFSETS } from '../../series-page/cover-stack';
import { useStyle } from './style';
import type { Book } from '../../../types';

interface SeriesRowProps {
  seriesName: string;
  books: Book[];          // sorted ascending by seriesIndex; books[0] = front cover
  progressMap: Map<string, number>;
  onClick: (name: string) => void;
}

function seriesProgressPct(books: Book[], progressMap: Map<string, number>): number | null {
  if (!books.some(b => progressMap.has(b.id))) return null;
  const avg = books.reduce((sum, b) => sum + (progressMap.get(b.id) ?? 0), 0) / books.length;
  return Math.round(avg * 100);
}

export function SeriesRow({ seriesName, books, progressMap, onClick }: SeriesRowProps) {
  const styles = useStyle();
  const author = books[0]?.author ?? '';
  const count = books.length;
  const pct = seriesProgressPct(books, progressMap);

  return (
    <div
      className={styles.root}
      role="button"
      tabIndex={0}
      onClick={() => onClick(seriesName)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(seriesName); }}
    >
      <CoverStack
        books={books}
        containerWidth={58}
        containerHeight={74}
        layerWidth={44}
        layerHeight={62}
        offsets={LIST_STACK_OFFSETS}
      />
      <div className={styles.info}>
        <div className={styles.name}>{seriesName}</div>
        <div className={styles.meta}>
          {author.length > 0 ? `${author} · ` : ''}
          {count} book{count !== 1 ? 's' : ''}
          {pct != null && <span className={styles.progress}> · {pct}%</span>}
        </div>
        <div className={styles.link}>View series →</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run — expect pass**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: PASS — 5 new tests pass (49 total).

- [ ] **Step 6: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/korzun/Code/HASS-ODPS
git add client/src/components/library-page/series-row/
git commit -m "feat: add SeriesRow component"
```

---

### Task 3: standalone-section

Collapsible section containing standalone books (not in any series). Renders a `BookCard` per book. Starts expanded (▼). Mocks `BookCard` in tests.

**Files:**
- Create: `client/src/components/library-page/standalone-section/style.ts`
- Create: `client/src/components/library-page/standalone-section/index.tsx`
- Create: `client/src/components/library-page/standalone-section/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/library-page/standalone-section/index.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import { StandaloneSection } from './index';
import type { Book } from '../../../types';

vi.mock('../../shared/book-card', () => ({
  BookCard: ({ book }: { book: Book }) => (
    <div data-testid="book-card" data-id={book.id} />
  ),
}));

function makeBook(id: string): Book {
  return {
    id,
    title: `Book ${id}`,
    author: 'Author',
    fileAs: 'Author',
    publisher: '',
    series: '',
    seriesIndex: 0,
    subjects: [],
    identifiers: [],
    hasCover: false,
    size: 1000,
    addedAt: '2024-01-01T00:00:00.000Z',
  };
}

const noop = () => {};
const books = [makeBook('a'), makeBook('b')];

it('renders book count in header', () => {
  renderWithProviders(
    <StandaloneSection
      books={books}
      progressMap={new Map()}
      isAdmin={false}
      onDelete={noop}
      onClearProgress={noop}
      onBookClick={noop}
    />
  );
  expect(screen.getByText(/2 books/)).toBeInTheDocument();
});

it('renders a BookCard for each book', () => {
  renderWithProviders(
    <StandaloneSection
      books={books}
      progressMap={new Map()}
      isAdmin={false}
      onDelete={noop}
      onClearProgress={noop}
      onBookClick={noop}
    />
  );
  expect(screen.getAllByTestId('book-card')).toHaveLength(2);
});

it('collapses book list on header click', async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <StandaloneSection
      books={books}
      progressMap={new Map()}
      isAdmin={false}
      onDelete={noop}
      onClearProgress={noop}
      onBookClick={noop}
    />
  );
  expect(screen.getAllByTestId('book-card')).toHaveLength(2);
  await user.click(screen.getByText(/standalone books/i));
  expect(screen.queryByTestId('book-card')).not.toBeInTheDocument();
});

it('expands again on second header click', async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <StandaloneSection
      books={books}
      progressMap={new Map()}
      isAdmin={false}
      onDelete={noop}
      onClearProgress={noop}
      onBookClick={noop}
    />
  );
  await user.click(screen.getByText(/standalone books/i));
  await user.click(screen.getByText(/standalone books/i));
  expect(screen.getAllByTestId('book-card')).toHaveLength(2);
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Create `client/src/components/library-page/standalone-section/style.ts`**

```ts
import { createUseStyles } from 'react-jss';
import type { Theme } from '../../../theme/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: { marginTop: '1.25rem' },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '.5rem',
    padding: '.5rem .25rem',
    cursor: 'pointer',
    userSelect: 'none',
    marginBottom: '.4rem',
  },
  chevron: { fontSize: '.65rem', color: theme.colors.text.faint, width: 12, flexShrink: 0 },
  label: {
    fontSize: '.75rem',
    fontWeight: 600,
    color: theme.colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: '.05em',
  },
  count: { fontSize: '.7rem', color: theme.colors.text.faint, marginLeft: '.25rem' },
}));
```

- [ ] **Step 4: Create `client/src/components/library-page/standalone-section/index.tsx`**

```tsx
import { useState } from 'react';
import { BookCard } from '../../shared/book-card';
import { useStyle } from './style';
import type { Book } from '../../../types';

interface StandaloneSectionProps {
  books: Book[];
  progressMap: Map<string, number>;
  isAdmin: boolean;
  onDelete: (id: string, title: string) => void;
  onClearProgress: (id: string) => void;
  onBookClick: (id: string) => void;
}

export function StandaloneSection({
  books,
  progressMap,
  isAdmin,
  onDelete,
  onClearProgress,
  onBookClick,
}: StandaloneSectionProps) {
  const styles = useStyle();
  const [open, setOpen] = useState(true);

  return (
    <div className={styles.root}>
      <div
        className={styles.header}
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setOpen(o => !o); }}
      >
        <span className={styles.chevron}>{open ? '▼' : '▶'}</span>
        <span className={styles.label}>Standalone Books</span>
        <span className={styles.count}>{books.length} book{books.length !== 1 ? 's' : ''}</span>
      </div>
      {open && (
        <div>
          {books.map(book => (
            <BookCard
              key={book.id}
              book={book}
              progress={progressMap.get(book.id)}
              isAdmin={isAdmin}
              onDelete={onDelete}
              onClearProgress={onClearProgress}
              onClick={onBookClick}
            />
          ))}
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

Expected: PASS — 4 new tests pass (53 total).

- [ ] **Step 6: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/korzun/Code/HASS-ODPS
git add client/src/components/library-page/standalone-section/
git commit -m "feat: add StandaloneSection component"
```

---

### Task 4: book-list

Receives `books` + `progressMap` as props, groups them with a local `groupBooks` function, and renders `SeriesRow` + `StandaloneSection`. Shows an empty message when `books` is empty. Mocks `SeriesRow` and `StandaloneSection` in tests.

**Files:**
- Create: `client/src/components/library-page/book-list/style.ts`
- Create: `client/src/components/library-page/book-list/index.tsx`
- Create: `client/src/components/library-page/book-list/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/library-page/book-list/index.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import { BookList } from './index';
import type { Book } from '../../../types';

vi.mock('../series-row', () => ({
  SeriesRow: ({ seriesName }: { seriesName: string }) => (
    <div data-testid="series-row" data-series={seriesName} />
  ),
}));

vi.mock('../standalone-section', () => ({
  StandaloneSection: ({ books }: { books: Book[] }) => (
    <div data-testid="standalone-section" data-count={String(books.length)} />
  ),
}));

function makeBook(overrides: Partial<Book>): Book {
  return {
    id: 'b1',
    title: 'Book',
    author: 'Author',
    fileAs: 'Author',
    publisher: '',
    series: '',
    seriesIndex: 0,
    subjects: [],
    identifiers: [],
    hasCover: false,
    size: 1000,
    addedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const noop = () => {};

it('shows empty message when books array is empty', () => {
  renderWithProviders(
    <BookList
      books={[]}
      progressMap={new Map()}
      isAdmin={false}
      onDelete={noop}
      onClearProgress={noop}
      onBookClick={noop}
      onSeriesClick={noop}
    />
  );
  expect(screen.getByText(/no books yet/i)).toBeInTheDocument();
});

it('renders a SeriesRow for a book with a series', () => {
  const book = makeBook({ id: 'b1', series: 'Dune', seriesIndex: 1 });
  renderWithProviders(
    <BookList
      books={[book]}
      progressMap={new Map()}
      isAdmin={false}
      onDelete={noop}
      onClearProgress={noop}
      onBookClick={noop}
      onSeriesClick={noop}
    />
  );
  expect(screen.getByTestId('series-row')).toBeInTheDocument();
  expect(screen.queryByTestId('standalone-section')).not.toBeInTheDocument();
});

it('renders StandaloneSection for books without a series', () => {
  const book = makeBook({ id: 'b1', series: '' });
  renderWithProviders(
    <BookList
      books={[book]}
      progressMap={new Map()}
      isAdmin={false}
      onDelete={noop}
      onClearProgress={noop}
      onBookClick={noop}
      onSeriesClick={noop}
    />
  );
  expect(screen.getByTestId('standalone-section')).toBeInTheDocument();
  expect(screen.queryByTestId('series-row')).not.toBeInTheDocument();
});

it('renders both SeriesRow and StandaloneSection for mixed books', () => {
  const books = [
    makeBook({ id: 'b1', series: 'Dune', seriesIndex: 1 }),
    makeBook({ id: 'b2', series: '' }),
  ];
  renderWithProviders(
    <BookList
      books={books}
      progressMap={new Map()}
      isAdmin={false}
      onDelete={noop}
      onClearProgress={noop}
      onBookClick={noop}
      onSeriesClick={noop}
    />
  );
  expect(screen.getByTestId('series-row')).toBeInTheDocument();
  expect(screen.getByTestId('standalone-section')).toBeInTheDocument();
});

it('renders one SeriesRow per unique series name', () => {
  const books = [
    makeBook({ id: 'b1', series: 'Dune', seriesIndex: 1 }),
    makeBook({ id: 'b2', series: 'Dune', seriesIndex: 2 }),
    makeBook({ id: 'b3', series: 'Foundation', seriesIndex: 1 }),
  ];
  renderWithProviders(
    <BookList
      books={books}
      progressMap={new Map()}
      isAdmin={false}
      onDelete={noop}
      onClearProgress={noop}
      onBookClick={noop}
      onSeriesClick={noop}
    />
  );
  expect(screen.getAllByTestId('series-row')).toHaveLength(2);
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Create `client/src/components/library-page/book-list/style.ts`**

```ts
import { createUseStyles } from 'react-jss';
import type { Theme } from '../../../theme/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  empty: {
    color: theme.colors.text.muted,
    textAlign: 'center',
    padding: '2rem',
  },
}));
```

- [ ] **Step 4: Create `client/src/components/library-page/book-list/index.tsx`**

```tsx
import { SeriesRow } from '../series-row';
import { StandaloneSection } from '../standalone-section';
import { useStyle } from './style';
import type { Book } from '../../../types';

interface GroupedBooks {
  series: [string, Book[]][];
  standalone: Book[];
}

function groupBooks(books: Book[]): GroupedBooks {
  const seriesMap = new Map<string, Book[]>();
  const standalone: Book[] = [];
  for (const book of books) {
    if (book.series.length > 0) {
      if (!seriesMap.has(book.series)) seriesMap.set(book.series, []);
      seriesMap.get(book.series)!.push(book);
    } else {
      standalone.push(book);
    }
  }
  for (const bks of seriesMap.values()) {
    bks.sort((a, b) => a.seriesIndex - b.seriesIndex);
  }
  const sortedSeries = [...seriesMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  standalone.sort((a, b) => a.title.localeCompare(b.title));
  return { series: sortedSeries, standalone };
}

interface BookListProps {
  books: Book[];
  progressMap: Map<string, number>;
  isAdmin: boolean;
  onDelete: (id: string, title: string) => void;
  onClearProgress: (id: string) => void;
  onBookClick: (id: string) => void;
  onSeriesClick: (name: string) => void;
}

export function BookList({
  books,
  progressMap,
  isAdmin,
  onDelete,
  onClearProgress,
  onBookClick,
  onSeriesClick,
}: BookListProps) {
  const styles = useStyle();

  if (books.length === 0) {
    return <p className={styles.empty}>No books yet. Upload some above.</p>;
  }

  const { series, standalone } = groupBooks(books);

  return (
    <div>
      {series.map(([name, bks]) => (
        <SeriesRow
          key={name}
          seriesName={name}
          books={bks}
          progressMap={progressMap}
          onClick={onSeriesClick}
        />
      ))}
      {standalone.length > 0 && (
        <StandaloneSection
          books={standalone}
          progressMap={progressMap}
          isAdmin={isAdmin}
          onDelete={onDelete}
          onClearProgress={onClearProgress}
          onBookClick={onBookClick}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run — expect pass**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: PASS — 5 new tests pass (58 total).

- [ ] **Step 6: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/korzun/Code/HASS-ODPS
git add client/src/components/library-page/book-list/
git commit -m "feat: add BookList component with groupBooks"
```

---

### Task 5: library-page + users-panel stub

`LibraryPage` owns `books`, `progressMap`, `loading`, and `activeTab` state. It fetches data on mount via `getBooks()` and (for non-admin) `getMyProgress()`, then passes everything down as props. `UsersPanel` is a stub that Plan 4 will replace.

**Files:**
- Create: `client/src/components/library-page/users-panel/index.tsx` (stub)
- Create: `client/src/components/library-page/style.ts`
- Create: `client/src/components/library-page/index.tsx`
- Create: `client/src/components/library-page/index.test.tsx`

- [ ] **Step 1: Create the UsersPanel stub**

Create `client/src/components/library-page/users-panel/index.tsx`:

```tsx
// Stub — replaced by Plan 4 (admin panel implementation)
export function UsersPanel() {
  return <div data-testid="users-panel-stub">Users panel</div>;
}
```

- [ ] **Step 2: Write the failing tests**

Create `client/src/components/library-page/index.test.tsx`:

```tsx
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils';
import { LibraryPage } from './index';
import { getBooks } from '../../api/books';
import { getMyProgress } from '../../api/progress';
import type { TabName } from '../tab-bar';

vi.mock('../tab-bar', () => ({
  TabBar: ({ onTabChange }: { active: TabName; onTabChange: (t: TabName) => void }) => (
    <div data-testid="tab-bar" onClick={() => onTabChange('users')} />
  ),
}));
vi.mock('./upload-zone', () => ({
  UploadZone: () => <div data-testid="upload-zone" />,
}));
vi.mock('./book-list', () => ({
  BookList: () => <div data-testid="book-list" />,
}));
vi.mock('./users-panel', () => ({
  UsersPanel: () => <div data-testid="users-panel" />,
}));
vi.mock('../../api/books', () => ({
  getBooks: vi.fn(),
  deleteBook: vi.fn(),
}));
vi.mock('../../api/progress', () => ({
  getMyProgress: vi.fn(),
  deleteMyProgress: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(getBooks).mockResolvedValue([]);
  vi.mocked(getMyProgress).mockResolvedValue([]);
});

it('shows loading state initially', () => {
  vi.mocked(getBooks).mockReturnValue(new Promise(() => {}));
  renderWithProviders(<LibraryPage />);
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});

it('renders upload-zone and book-list after data loads', async () => {
  renderWithProviders(<LibraryPage />);
  // BookList only appears once loading completes; UploadZone renders even during loading
  await waitFor(() => expect(screen.getByTestId('book-list')).toBeInTheDocument());
  expect(screen.getByTestId('upload-zone')).toBeInTheDocument();
});

it('shows users-panel when users tab is clicked', async () => {
  renderWithProviders(
    <LibraryPage />,
    { user: { username: 'admin', isAdmin: true } }
  );
  await waitFor(() => expect(screen.getByTestId('tab-bar')).toBeInTheDocument());
  act(() => {
    screen.getByTestId('tab-bar').click();
  });
  expect(screen.getByTestId('users-panel')).toBeInTheDocument();
  expect(screen.queryByTestId('book-list')).not.toBeInTheDocument();
});

it('does not call getMyProgress for admin users', async () => {
  renderWithProviders(
    <LibraryPage />,
    { user: { username: 'admin', isAdmin: true } }
  );
  await waitFor(() => expect(screen.getByTestId('book-list')).toBeInTheDocument());
  expect(vi.mocked(getMyProgress)).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run — expect failure**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 4: Create `client/src/components/library-page/style.ts`**

```ts
import { createUseStyles } from 'react-jss';
import type { Theme } from '../../theme/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  main: {
    maxWidth: 800,
    margin: '2rem auto',
    padding: '0 1rem',
  },
  loading: {
    color: theme.colors.text.muted,
    textAlign: 'center',
    padding: '2rem',
  },
}));
```

- [ ] **Step 5: Create `client/src/components/library-page/index.tsx`**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/auth-provider';
import { getBooks, deleteBook } from '../../api/books';
import { getMyProgress, deleteMyProgress } from '../../api/progress';
import { TabBar, type TabName } from '../tab-bar';
import { UploadZone } from './upload-zone';
import { BookList } from './book-list';
import { UsersPanel } from './users-panel';
import { useStyle } from './style';
import type { Book, Progress } from '../../types';

export function LibraryPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const styles = useStyle();
  const [activeTab, setActiveTab] = useState<TabName>('library');
  const [books, setBooks] = useState<Book[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [bookList, progressList] = await Promise.all([
        getBooks(),
        isAdmin ? Promise.resolve<Progress[]>([]) : getMyProgress(),
      ]);
      setBooks(bookList);
      setProgressMap(new Map(progressList.map(p => [p.document, p.percentage])));
    } catch {
      setBooks([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleDelete(id: string, title: string) {
    if (!confirm(`Delete "${title}"?`)) return;
    try {
      await deleteBook(id);
      await loadData();
    } catch {
      alert('Failed to delete book.');
    }
  }

  async function handleClearProgress(id: string) {
    try {
      await deleteMyProgress(id);
      await loadData();
    } catch {
      alert('Failed to clear reading status.');
    }
  }

  return (
    <main className={styles.main}>
      <TabBar active={activeTab} onTabChange={setActiveTab} />
      {activeTab === 'library' ? (
        <>
          <UploadZone
            isAdmin={isAdmin}
            onUploadComplete={loadData}
            onScanComplete={loadData}
          />
          {loading ? (
            <p className={styles.loading}>Loading…</p>
          ) : (
            <BookList
              books={books}
              progressMap={progressMap}
              isAdmin={isAdmin}
              onDelete={handleDelete}
              onClearProgress={handleClearProgress}
              onBookClick={id => navigate(`/books/${encodeURIComponent(id)}`)}
              onSeriesClick={name => navigate(`/series/${encodeURIComponent(name)}`)}
            />
          )}
        </>
      ) : (
        <UsersPanel />
      )}
    </main>
  );
}
```

- [ ] **Step 6: Run — expect pass**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm test
```

Expected: PASS — 4 new tests pass (62 total).

- [ ] **Step 7: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS/client && npm run lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/korzun/Code/HASS-ODPS
git add client/src/components/library-page/
git commit -m "feat: add LibraryPage with data fetching, tab switching, and UsersPanel stub"
```

---

## Plan 3 complete

All five library-page components are implemented and tested:
- `UploadZone` — drag-and-drop upload + admin scan button (6 tests)
- `SeriesRow` — series entry with CoverStack, author, count, progress (5 tests)
- `StandaloneSection` — collapsible standalone books list (4 tests)
- `BookList` — groups books via `groupBooks`, renders series rows and standalone section (5 tests)
- `LibraryPage` — owns state, fetches books + progress, handles tab switching (4 tests)

**Total tests after Plan 3:** 62 passing

**Next:** Plan 4 — Admin panel (`register-user-form`, `user-row`, `users-panel`) — replaces the `UsersPanel` stub

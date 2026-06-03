# Book Lineage UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only "ID Lineage" card to the book detail page showing the git-log-style history of book ID changes caused by reimports.

**Architecture:** A new Prisma migration adds a `timestamp` column to `book_id_history`. A new `BookStore.getBookLineage()` method and `GET /api/books/:id/lineage` endpoint (admin-gated) serve the data. A new `BookLineageCard` React component fetches and renders the lineage; it is added to `BookPage` gated by `isAdmin`.

**Tech Stack:** SQLite + Prisma (server), Express + supertest (route tests), Jest (server tests), React + JSS `createUseStyles` (client), Vitest (client tests).

---

## File Map

**Create:**
- `app/server/prisma/migrations/0002_add_book_id_history_timestamp/migration.sql`
- `app/client/src/provider/book/hook/use-book-lineage.ts`
- `app/client/src/component/book-lineage-card/index.tsx`
- `app/client/src/component/book-lineage-card/style.ts`

**Modify:**
- `app/server/prisma/schema.prisma` — add `timestamp` field to `BookIdHistory`
- `app/server/services/book-store.ts` — add `getBookLineage()`, update `reimportBook()` inserts
- `app/server/services/book-store.test.ts` — tests for `getBookLineage()` and timestamp on reimport
- `app/server/routes/ui.ts` — add `GET /api/books/:id/lineage` route
- `app/server/routes/ui.test.ts` — route tests
- `app/client/src/component/index.ts` — export `BookLineageCard`
- `app/client/src/page/book/index.tsx` — add `<BookLineageCard>` for admin

---

## Task 1: Database Migration — Add `timestamp` to `book_id_history`

**Files:**
- Create: `app/server/prisma/migrations/0002_add_book_id_history_timestamp/migration.sql`
- Modify: `app/server/prisma/schema.prisma`

- [ ] **Step 1: Create the migration directory and SQL file**

```bash
mkdir -p app/server/prisma/migrations/0002_add_book_id_history_timestamp
```

Create `app/server/prisma/migrations/0002_add_book_id_history_timestamp/migration.sql`:

```sql
-- Recreate book_id_history with a timestamp column.
-- SQLite ADD COLUMN only accepts constant literals for NOT NULL defaults,
-- so we recreate the table. Existing rows are backfilled with the migration
-- run time (best available approximation).
CREATE TABLE "book_id_history_new" (
    "old_id"     TEXT NOT NULL PRIMARY KEY,
    "current_id" TEXT NOT NULL,
    "timestamp"  REAL NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

INSERT INTO "book_id_history_new" ("old_id", "current_id", "timestamp")
SELECT "old_id", "current_id", (strftime('%s', 'now') * 1000)
FROM "book_id_history";

DROP TABLE "book_id_history";

ALTER TABLE "book_id_history_new" RENAME TO "book_id_history";
```

- [ ] **Step 2: Update the Prisma schema**

In `app/server/prisma/schema.prisma`, replace the existing `BookIdHistory` model:

```prisma
model BookIdHistory {
  oldId     String @id @map("old_id")
  currentId String @map("current_id")
  timestamp Float  @default(dbgenerated("(strftime('%s', 'now') * 1000)"))

  @@map("book_id_history")
}
```

- [ ] **Step 3: Regenerate the Prisma client**

```bash
cd app/server && npm run prisma:generate
```

Expected: exits 0, regenerates `node_modules/@prisma/client`.

- [ ] **Step 4: Verify the migration is picked up by the test suite**

The test suite uses `runMigrations()` which reads from `prisma/migrations/`. Run one existing book-store test to confirm it still passes with the new schema:

```bash
cd app/server && npx jest --testPathPattern=book-store --testNamePattern="inserts a book" --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/server/prisma/migrations/0002_add_book_id_history_timestamp/migration.sql \
        app/server/prisma/schema.prisma
git commit -m "feat: add timestamp column to book_id_history (migration v2)"
```

---

## Task 2: `BookStore.getBookLineage()` and Timestamp on Reimport

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

### 2a — Write failing tests

- [ ] **Step 1: Add tests to `book-store.test.ts`**

Find the `describe('book_id_history table'` block (around line 1248) and add a new describe block after the closing `});` of `describe('resolveBookId — lineage via reimportBook'`:

```ts
describe('getBookLineage', () => {
  it('returns null for a book that does not exist', async () => {
    expect(await bookStore.getBookLineage('no-such-id')).toBeNull();
  });

  it('returns currentId with empty entries for a book with no history', async () => {
    await bookStore.addBook('id-a', stage('id-a'), FAKE_META);
    const result = await bookStore.getBookLineage('id-a');
    expect(result).toEqual({ currentId: 'id-a', entries: [] });
  });

  it('returns one entry after a single reimport that changes the ID', async () => {
    const before = Date.now();
    await bookStore.addBook('id-a', stage('id-a'), FAKE_META);
    const epubPath = path.join(booksDir, 'id-a.epub');
    fs.writeFileSync(epubPath, 'content-a');
    await bookStore.reimportBook('id-a', makeImporterWithId('id-b'));
    const after = Date.now();

    const result = await bookStore.getBookLineage('id-b');
    expect(result).not.toBeNull();
    expect(result!.currentId).toBe('id-b');
    expect(result!.entries).toHaveLength(1);
    expect(result!.entries[0].oldId).toBe('id-a');
    expect(result!.entries[0].newId).toBe('id-b');
    expect(result!.entries[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(result!.entries[0].timestamp).toBeLessThanOrEqual(after);
  });

  it('entries are ordered newest-first', async () => {
    await bookStore.addBook('id-a', stage('id-a'), FAKE_META);
    fs.writeFileSync(path.join(booksDir, 'id-a.epub'), 'content-a');
    await bookStore.reimportBook('id-a', makeImporterWithId('id-b'));
    fs.writeFileSync(path.join(booksDir, 'id-b.epub'), 'content-b');
    await bookStore.reimportBook('id-b', makeImporterWithId('id-c'));

    const result = await bookStore.getBookLineage('id-c');
    expect(result!.entries).toHaveLength(2);
    expect(result!.entries[0].oldId).toBe('id-b');
    expect(result!.entries[0].newId).toBe('id-c');
    expect(result!.entries[1].oldId).toBe('id-a');
    expect(result!.entries[1].newId).toBe('id-b');
    expect(result!.entries[0].timestamp).toBeGreaterThanOrEqual(result!.entries[1].timestamp);
  });
});
```

Note: `makeImporterWithId` is already defined in the existing test file (in the `resolveBookId — lineage via reimportBook` describe block).

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
cd app/server && npx jest --testPathPattern=book-store --testNamePattern="getBookLineage" --no-coverage
```

Expected: FAIL — `bookStore.getBookLineage is not a function`

### 2b — Implement

- [ ] **Step 3: Add `getBookLineage()` to `BookStore` and add timestamp to `reimportBook()`**

In `app/server/services/book-store.ts`:

After the `resolveBookId` method (around line 126), add:

```ts
async getBookLineage(id: string): Promise<{
  currentId: string;
  entries: { oldId: string; newId: string; timestamp: number }[];
} | null> {
  const book = await this.prisma.book.findUnique({ where: { id }, select: { id: true } });
  if (!book) return null;

  const rows = await this.prisma.$queryRaw<Array<{ old_id: string; timestamp: number }>>`
    SELECT old_id, timestamp FROM book_id_history
    WHERE current_id = ${id}
    ORDER BY timestamp DESC
  `;

  const entries = rows.map((row, i, arr) => ({
    oldId: row.old_id,
    newId: i === 0 ? id : arr[i - 1].old_id,
    timestamp: row.timestamp,
  }));

  return { currentId: id, entries };
}
```

In the same file, update the two `$executeRaw` statements inside `reimportBook()` that write to `book_id_history` (around line 249). Replace:

```ts
await tx.$executeRaw`INSERT OR REPLACE INTO book_id_history (old_id, current_id) VALUES (${id}, ${newId})`;
await tx.$executeRaw`UPDATE book_id_history SET current_id = ${newId} WHERE current_id = ${id}`;
```

with:

```ts
await tx.$executeRaw`
  INSERT OR REPLACE INTO book_id_history (old_id, current_id, timestamp)
  VALUES (${id}, ${newId}, ${Date.now()})
`;
await tx.$executeRaw`
  UPDATE book_id_history SET current_id = ${newId}
  WHERE current_id = ${id}
`;
```

- [ ] **Step 4: Run all `getBookLineage` tests**

```bash
cd app/server && npx jest --testPathPattern=book-store --testNamePattern="getBookLineage" --no-coverage
```

Expected: all PASS

- [ ] **Step 5: Run the full book-store test suite to check for regressions**

```bash
cd app/server && npx jest --testPathPattern=book-store --no-coverage
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: add BookStore.getBookLineage() and timestamp to reimportBook history"
```

---

## Task 3: `GET /api/books/:id/lineage` Route

**Files:**
- Modify: `app/server/routes/ui.ts`
- Modify: `app/server/routes/ui.test.ts`

### 3a — Write failing tests

- [ ] **Step 1: Add route tests to `ui.test.ts`**

Find where the book-related route describe blocks live and add a new describe block. Look for an existing `describe` for book routes (e.g. `describe('GET /api/books/:id'`) and add after it:

```ts
describe('GET /api/books/:id/lineage', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/books/some-id/lineage');
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated as a regular user', async () => {
    const agent = await userAgent();
    const res = await agent.get('/api/books/some-id/lineage');
    expect(res.status).toBe(403);
  });

  it('returns 404 when book does not exist', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/api/books/no-such-book/lineage');
    expect(res.status).toBe(404);
  });

  it('returns lineage with empty entries for a book with no history', async () => {
    const agent = await adminAgent();
    const epubBuf = makeEpub({ title: 'Lineage Test' });
    const epubPath = path.join(booksDir, 'lin-id.epub');
    fs.writeFileSync(epubPath, epubBuf);
    await bookStore.addBook('lin-id', epubPath, FAKE_META);

    const res = await agent.get('/api/books/lin-id/lineage');
    expect(res.status).toBe(200);
    expect(res.body.currentId).toBe('lin-id');
    expect(res.body.entries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
cd app/server && npx jest --testPathPattern=routes/ui --testNamePattern="GET /api/books/:id/lineage" --no-coverage
```

Expected: FAIL — route not found (404 or missing)

### 3b — Implement

- [ ] **Step 3: Add the route to `ui.ts`**

In `app/server/routes/ui.ts`, after the `GET /api/books/:id` route (around line 272), add:

```ts
router.get('/api/books/:id/lineage', sessionAuth, adminAuth, async (req: Request, res: Response) => {
  const lineage = await bookStore.getBookLineage(req.params.id);
  if (!lineage) {
    res.status(404).json({ error: 'Book not found' });
    return;
  }
  res.json(lineage);
});
```

- [ ] **Step 4: Run the lineage route tests**

```bash
cd app/server && npx jest --testPathPattern=routes/ui --testNamePattern="GET /api/books/:id/lineage" --no-coverage
```

Expected: all PASS

- [ ] **Step 5: Run the full ui route test suite**

```bash
cd app/server && npx jest --testPathPattern=routes/ui --no-coverage
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add app/server/routes/ui.ts app/server/routes/ui.test.ts
git commit -m "feat: add GET /api/books/:id/lineage admin route"
```

---

## Task 4: `useBookLineage` Hook

**Files:**
- Create: `app/client/src/provider/book/hook/use-book-lineage.ts`

- [ ] **Step 1: Create the hook**

```ts
import { useCallback, useEffect, useState } from 'react';

export type LineageEntry = {
  oldId: string;
  newId: string;
  timestamp: number;
};

export type BookLineage = {
  currentId: string;
  entries: LineageEntry[];
};

export type UseBookLineage =
  | [undefined, true, false]
  | [undefined, false, true]
  | [BookLineage, false, false];

export const useBookLineage = (bookId: string): UseBookLineage => {
  const [data, setData] = useState<BookLineage | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchLineage = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/lineage`);
      if (!response.ok) throw new Error('Failed to fetch lineage');
      setData(await (response.json() as Promise<BookLineage>));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void fetchLineage();
  }, [fetchLineage]);

  if (loading) return [undefined, true, false];
  if (error) return [undefined, false, true];
  return [data!, false, false];
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd app/client && npm run type
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/client/src/provider/book/hook/use-book-lineage.ts
git commit -m "feat: add useBookLineage hook"
```

---

## Task 5: `BookLineageCard` Component

**Files:**
- Create: `app/client/src/component/book-lineage-card/index.tsx`
- Create: `app/client/src/component/book-lineage-card/style.ts`
- Modify: `app/client/src/component/index.ts`

- [ ] **Step 1: Create `style.ts`**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  list: {
    listStyle: 'none',
    margin: 0,
    padding: `${theme.space.md} ${theme.space.xl}`,
  },
  entry: {
    display: 'flex',
    gap: 0,
  },
  connector: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '20px',
    flexShrink: 0,
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: theme.radius.circle,
    backgroundColor: theme.color.blue[400],
    marginTop: '4px',
    flexShrink: 0,
  },
  dotCurrent: {
    backgroundColor: theme.color.brand.default,
  },
  dotInitial: {
    backgroundColor: theme.color.success,
  },
  line: {
    width: '2px',
    backgroundColor: theme.color.border.light,
    flex: 1,
    margin: `${theme.space.xs} 0`,
    minHeight: '16px',
  },
  entryContent: {
    paddingBottom: theme.space.xxxl,
    paddingLeft: theme.space.md,
    flex: 1,
    minWidth: 0,
  },
  entryId: {
    fontFamily: "'Cascadia Code', 'Fira Code', monospace",
    fontSize: theme.fontSize.sm,
    color: theme.color.text.secondary,
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    wordBreak: 'break-all',
  },
  badge: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    padding: `${theme.space.xxxs} ${theme.space.xs}`,
    borderRadius: theme.radius.sm,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    flexShrink: 0,
  },
  badgeCurrent: {
    backgroundColor: theme.color.brand.light,
    color: theme.color.brand.default,
    border: `1px solid ${theme.color.brand.outline}`,
  },
  badgeInitial: {
    backgroundColor: theme.color.success,
    color: '#fff',
    border: 'none',
    opacity: 0.85,
  },
  timestamp: {
    fontSize: theme.fontSize.xs,
    color: theme.color.text.faint,
    marginTop: theme.space.xxs,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.color.danger.default,
    padding: `${theme.space.md} ${theme.space.xl}`,
  },
  loading: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.faint,
    padding: `${theme.space.md} ${theme.space.xl}`,
  },
}));
```

- [ ] **Step 2: Create `index.tsx`**

`addedAt` (milliseconds) is passed from `BookPage` and used as the "born at" timestamp for the initial ID (the one that was never renamed-to, only renamed-from). Each row shows the timestamp when that ID first became the current book ID:
- Current ID: the most recent rename's timestamp (or `addedAt` if never reimported)
- Old ID at index i in entries: `entries[i+1].timestamp` (when it was created by being renamed-to), falling back to `addedAt` for the oldest entry

```tsx
import cx from 'classnames';

import { Card } from '../card';
import { useBookLineage } from '~/provider/book/hook/use-book-lineage';
import { useStyle } from './style';

type Props = { bookId: string; addedAt?: number };

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export const BookLineageCard = ({ bookId, addedAt }: Props) => {
  const styles = useStyle();
  const [lineage, loading, error] = useBookLineage(bookId);

  if (loading) {
    return (
      <Card title="ID Lineage">
        <p className={styles.loading}>Loading…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="ID Lineage">
        <p className={styles.error}>Failed to load lineage.</p>
      </Card>
    );
  }

  // Build display rows: current ID first, then old IDs newest-first.
  // Each row's timestamp = "when this ID first became the current book ID":
  //   current  → entries[0].timestamp  (last rename), or addedAt if no history
  //   entries[i].oldId → entries[i+1].timestamp (the rename that created it), or addedAt
  type Row = { id: string; timestamp: number | undefined; isCurrent: boolean; isInitial: boolean };
  const { entries } = lineage;

  const rows: Row[] = [
    {
      id: lineage.currentId,
      timestamp: entries.length > 0 ? entries[0].timestamp : addedAt,
      isCurrent: true,
      isInitial: false,
    },
    ...entries.map((entry, i) => ({
      id: entry.oldId,
      timestamp: entries[i + 1]?.timestamp ?? addedAt,
      isCurrent: false,
      isInitial: i === entries.length - 1,
    })),
  ];

  return (
    <Card title="ID Lineage">
      <ul className={styles.list}>
        {rows.map((row, i) => (
          <li key={row.id} className={styles.entry}>
            <div className={styles.connector}>
              <div
                className={cx(styles.dot, {
                  [styles.dotCurrent]: row.isCurrent,
                  [styles.dotInitial]: row.isInitial,
                })}
              />
              {i < rows.length - 1 && <div className={styles.line} />}
            </div>
            <div className={styles.entryContent}>
              <div className={styles.entryId}>
                {row.id}
                {row.isCurrent && (
                  <span className={cx(styles.badge, styles.badgeCurrent)}>current</span>
                )}
                {row.isInitial && (
                  <span className={cx(styles.badge, styles.badgeInitial)}>initial</span>
                )}
              </div>
              {row.timestamp !== undefined && (
                <div className={styles.timestamp}>{formatTimestamp(row.timestamp)}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
};
```

- [ ] **Step 3: Export from `component/index.ts`**

Add this line in alphabetical order in `app/client/src/component/index.ts`:

```ts
export { BookLineageCard } from './book-lineage-card';
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd app/client && npm run type
```

Expected: no errors

- [ ] **Step 5: Run client tests**

```bash
cd app/client && npm test
```

Expected: all PASS (no new tests required for a pure-render component with a mocked hook; type-checking is the verification)

- [ ] **Step 6: Commit**

```bash
git add app/client/src/component/book-lineage-card/ \
        app/client/src/component/index.ts
git commit -m "feat: add BookLineageCard component"
```

---

## Task 6: Wire `BookLineageCard` into `BookPage`

**Files:**
- Modify: `app/client/src/page/book/index.tsx`

- [ ] **Step 1: Add the import**

In `app/client/src/page/book/index.tsx`, add `BookLineageCard` to the existing component import line at the top:

```ts
import { Card, Page, ProgressIndicator, Tag, MetadataList, BookLineageCard, type Metadata } from '~/component';
```

- [ ] **Step 2: Add the card to the JSX**

In the same file, find the `<Card title="Subjects">` block (around line 129). Immediately after its closing `</Card>`, add:

```tsx
{isAdmin && (
  <BookLineageCard
    bookId={book.id}
    addedAt={book.addedAt ? new Date(book.addedAt).getTime() : undefined}
  />
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd app/client && npm run type
```

Expected: no errors

- [ ] **Step 4: Run client tests**

```bash
cd app/client && npm test
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add app/client/src/page/book/index.tsx
git commit -m "feat: show BookLineageCard on book page for admins"
```

---

## Task 7: Full Test Suite Verification

- [ ] **Step 1: Run the full server test suite**

```bash
cd app/server && npx jest --no-coverage
```

Expected: all PASS

- [ ] **Step 2: Run the full client test suite**

```bash
cd app/client && npm test
```

Expected: all PASS

- [ ] **Step 3: Run client type check**

```bash
cd app/client && npm run type
```

Expected: no errors

- [ ] **Step 4: Run server lint**

```bash
cd app/server && npm run lint
```

Expected: no errors

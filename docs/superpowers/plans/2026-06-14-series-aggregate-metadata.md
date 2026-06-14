# Series Aggregate Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `Series` table with five denormalised aggregate fields (`subjects`, `bookCount`, `author`, `publisher`, `totalPages`), keep them in sync at write time, expose them via `GET /api/series/:name`, and display them on the series page with a new Subjects card.

**Architecture:** Aggregation happens in a new private `recomputeSeriesMeta` method on `BookStore`, called inside the existing transactions in `addBook`, `reimportBook`, and `deleteBook`. A lightweight `GET /api/series/:name` route reads the stored values directly (O(1) read). A new `useSeries` React hook fetches the route; the series page uses it for all aggregate metadata.

**Tech Stack:** SQLite via Prisma (server), Jest (server tests), React + Vitest (client tests), supertest (API tests), TypeScript throughout.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `app/server/prisma/schema.prisma` | Add 5 fields to `Series` model |
| Create | `app/server/prisma/migrations/20260614000000_add_series_aggregate_fields/migration.sql` | DDL: 5 `ALTER TABLE` statements |
| Modify | `app/server/db/migrate.ts` | Add `data_v13_series_meta` backfill |
| Modify | `app/server/services/book-store.ts` | `recomputeSeriesMeta`, updated `addBook`/`reimportBook`/`deleteBook`, `getSeriesByName` |
| Modify | `app/server/services/book-store.test.ts` | Tests for aggregate fields on all write paths |
| Modify | `app/server/routes/ui.ts` | `GET /api/series/:name` route |
| Modify | `app/server/routes/ui.test.ts` | Tests for new route |
| Create | `app/client/src/provider/book/hook/use-series.ts` | Hook: fetch + return `SeriesMeta` |
| Create | `app/client/src/provider/book/hook/use-series.test.ts` | Tests for `useSeries` |
| Modify | `app/client/src/provider/book/hook/index.ts` | Export `useSeries` |
| Modify | `app/client/src/provider/book/index.ts` | Re-export `useSeries` |
| Modify | `app/client/src/page/series/index.tsx` | Use `useSeries`, add Subjects card |

---

## Task 1: Schema + DDL Migration

**Files:**
- Modify: `app/server/prisma/schema.prisma`
- Create: `app/server/prisma/migrations/20260614000000_add_series_aggregate_fields/migration.sql`

- [ ] **Step 1: Add fields to the `Series` model in schema.prisma**

Replace the existing `Series` model:

```prisma
model Series {
  id         String @id
  userId     String @map("user_id")
  name       String
  sortKey    String @map("sort_key")
  subjects   String @default("[]")
  bookCount  Int    @default(0) @map("book_count")
  author     String @default("")
  publisher  String @default("")
  totalPages Int    @default(0) @map("total_pages")
  user       User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  books      Book[]

  @@unique([userId, name])
  @@map("series")
}
```

- [ ] **Step 2: Create the migration directory and SQL file**

Create `app/server/prisma/migrations/20260614000000_add_series_aggregate_fields/migration.sql`:

```sql
ALTER TABLE series ADD COLUMN subjects TEXT NOT NULL DEFAULT '[]';
ALTER TABLE series ADD COLUMN book_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE series ADD COLUMN author TEXT NOT NULL DEFAULT '';
ALTER TABLE series ADD COLUMN publisher TEXT NOT NULL DEFAULT '';
ALTER TABLE series ADD COLUMN total_pages INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 3: Regenerate Prisma client**

```bash
cd app/server && npm run prisma:generate
```

Expected: Prisma client regenerated with no errors.

- [ ] **Step 4: Verify migration applies cleanly**

```bash
cd app/server && npm test -- --testPathPattern=migrate
```

Expected: All migrate tests pass (the new migration will be applied in the fresh test DBs automatically).

- [ ] **Step 5: Commit**

```bash
git add app/server/prisma/schema.prisma app/server/prisma/migrations/20260614000000_add_series_aggregate_fields/
git commit -m "feat: add aggregate fields to Series schema"
```

---

## Task 2: `recomputeSeriesMeta` + `addBook` integration

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

- [ ] **Step 1: Write failing tests for series aggregate fields after `addBook`**

Add a new `describe` block at the end of `app/server/services/book-store.test.ts`:

```typescript
describe('series aggregate metadata', () => {
  it('sets bookCount, author, publisher, totalPages, subjects after addBook', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'Dune',
      subjects: ['Science Fiction', 'Space Opera'],
      author: 'Frank Herbert',
      publisher: 'Chilton Books',
      pageCount: 412,
    });

    const series = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'Dune' } });
    expect(series).not.toBeNull();
    expect(series!.bookCount).toBe(1);
    expect(series!.author).toBe('Frank Herbert');
    expect(series!.publisher).toBe('Chilton Books');
    expect(series!.totalPages).toBe(412);
    expect(JSON.parse(series!.subjects)).toEqual(['Science Fiction', 'Space Opera']);
  });

  it('deduplicates subjects case-insensitively across books and sorts them', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'Dune',
      subjects: ['Science Fiction', 'Epic'],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      series: 'Dune',
      seriesIndex: 2,
      subjects: ['science fiction', 'Adventure'],
    });

    const series = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'Dune' } });
    // 'science fiction' deduped with 'Science Fiction' (first-seen wins); sorted alphabetically
    expect(JSON.parse(series!.subjects)).toEqual(['Adventure', 'Epic', 'Science Fiction']);
    expect(series!.bookCount).toBe(2);
  });

  it('deduplicates authors and publishers case-insensitively, joins with ", "', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'Shared',
      author: 'Alice Writer',
      publisher: 'Big Press',
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      series: 'Shared',
      seriesIndex: 2,
      author: 'alice writer',
      publisher: 'Small Press',
    });

    const series = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'Shared' } });
    expect(series!.author).toBe('Alice Writer'); // case-insensitive dedup, first wins
    expect(series!.publisher).toBe('Big Press, Small Press');
  });

  it('accumulates totalPages across books', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META, series: 'S', pageCount: 100,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META, series: 'S', seriesIndex: 2, pageCount: 200,
    });

    const series = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'S' } });
    expect(series!.totalPages).toBe(300);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
cd app/server && npm test -- --testPathPattern=book-store --testNamePattern="series aggregate"
```

Expected: FAIL — `bookCount` is 0, fields are defaults.

- [ ] **Step 3: Add `recomputeSeriesMeta` to `BookStore`**

Add this private method to `BookStore` (just before `prismaBookToBook`):

```typescript
private async recomputeSeriesMeta(
  client: Pick<PrismaClient, 'book' | 'series'>,
  seriesId: string
): Promise<void> {
  const books = await client.book.findMany({
    where: { seriesId },
    select: { subjects: true, author: true, publisher: true, pageCount: true },
  });

  const bookCount = books.length;
  const totalPages = books.reduce((sum, b) => sum + b.pageCount, 0);

  const seenSubjects = new Map<string, string>();
  for (const book of books) {
    for (const s of JSON.parse(book.subjects) as string[]) {
      const key = s.toLowerCase();
      if (!seenSubjects.has(key)) seenSubjects.set(key, s);
    }
  }
  const subjects = [...seenSubjects.values()].sort((a, b) => a.localeCompare(b));

  const seenAuthors = new Map<string, string>();
  for (const book of books) {
    if (book.author) {
      const key = book.author.toLowerCase();
      if (!seenAuthors.has(key)) seenAuthors.set(key, book.author);
    }
  }
  const author = [...seenAuthors.values()].join(', ');

  const seenPublishers = new Map<string, string>();
  for (const book of books) {
    if (book.publisher) {
      const key = book.publisher.toLowerCase();
      if (!seenPublishers.has(key)) seenPublishers.set(key, book.publisher);
    }
  }
  const publisher = [...seenPublishers.values()].join(', ');

  await client.series.update({
    where: { id: seriesId },
    data: { subjects: JSON.stringify(subjects), bookCount, author, publisher, totalPages },
  });
}
```

- [ ] **Step 4: Wrap `addBook`'s DB operations in a transaction and call `recomputeSeriesMeta`**

In `addBook`, replace the existing two separate awaits (series upsert and book create) with a single `$transaction` block. The `existing` check and filesystem operations stay outside the transaction. The full DB section becomes:

```typescript
await this.prisma.$transaction(async (tx) => {
  let seriesId: string | null = null;
  const seriesName = meta.series.trim();
  if (seriesName) {
    const s = await tx.series.upsert({
      where: { userId_name: { userId: owner.userId, name: seriesName } },
      create: { id: randomUUID(), userId: owner.userId, name: seriesName, sortKey: seriesName },
      update: {},
      select: { id: true },
    });
    seriesId = s.id;
  }

  await tx.book.create({
    data: {
      userId: owner.userId,
      id,
      title,
      titleSort,
      authorSort,
      publishDate,
      author: meta.author,
      description: meta.description,
      publisher: meta.publisher,
      series: meta.series,
      seriesIndex: meta.seriesIndex,
      identifiers: JSON.stringify(meta.identifiers),
      subjects: JSON.stringify(meta.subjects),
      coverData: meta.coverData as unknown as Prisma.Bytes | null,
      coverMime: meta.coverMime,
      size: stat.size,
      mtime: stat.mtimeMs,
      addedAt: Date.now(),
      chapterCount: meta.chapterCount,
      chapterSpineMap: JSON.stringify(meta.chapterSpineMap),
      chapterNames: JSON.stringify(meta.chapterNames),
      pageCount: meta.pageCount,
      seriesId,
    },
  });

  if (seriesId) {
    await this.recomputeSeriesMeta(tx, seriesId);
  }
});
```

- [ ] **Step 5: Run the tests to see them pass**

```bash
cd app/server && npm test -- --testPathPattern=book-store --testNamePattern="series aggregate"
```

Expected: All 4 new tests pass.

- [ ] **Step 6: Run the full book-store test suite to check for regressions**

```bash
cd app/server && npm test -- --testPathPattern=book-store
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: add recomputeSeriesMeta and call it from addBook"
```

---

## Task 3: `reimportBook` integration

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

- [ ] **Step 1: Write failing tests for `reimportBook` updating series meta**

Add to the `series aggregate metadata` describe block in `book-store.test.ts`:

```typescript
it('updates series meta after reimportBook changes subjects', async () => {
  await bookStore.addBook(OWNER, 'b1', stage('b1'), {
    ...FAKE_META,
    series: 'Dune',
    subjects: ['Science Fiction'],
    pageCount: 100,
  });

  const epub = makeMinimalEpub('Dune Messiah');
  const newPath = path.join(booksDir, 'b1.epub');
  fs.writeFileSync(newPath, epub);

  const mockImporter: ScanImporter = {
    parseEpub: () => ({
      ...FAKE_META,
      title: 'Dune Messiah',
      series: 'Dune',
      subjects: ['Science Fiction', 'Politics'],
      pageCount: 200,
    }),
    partialMD5: () => 'b1',
  };

  await bookStore.reimportBook(OWNER, 'b1', mockImporter);

  const series = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'Dune' } });
  expect(JSON.parse(series!.subjects)).toEqual(['Politics', 'Science Fiction']);
  expect(series!.totalPages).toBe(200);
});

it('updates both old and new series when reimportBook changes series membership', async () => {
  await bookStore.addBook(OWNER, 'b1', stage('b1'), {
    ...FAKE_META,
    series: 'Old Series',
    subjects: ['Fantasy'],
    pageCount: 100,
  });
  await bookStore.addBook(OWNER, 'b2', stage('b2'), {
    ...FAKE_META,
    series: 'Old Series',
    seriesIndex: 2,
    subjects: ['Fantasy', 'Magic'],
    pageCount: 150,
  });

  const newPath = path.join(booksDir, 'b1.epub');
  fs.writeFileSync(newPath, makeMinimalEpub('New Book'));
  const mockImporter: ScanImporter = {
    parseEpub: () => ({
      ...FAKE_META,
      title: 'New Book',
      series: 'New Series',
      subjects: ['Horror'],
      pageCount: 80,
    }),
    partialMD5: () => 'b1',
  };

  await bookStore.reimportBook(OWNER, 'b1', mockImporter);

  const oldSeries = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'Old Series' } });
  expect(oldSeries).not.toBeNull();
  expect(oldSeries!.bookCount).toBe(1);
  expect(JSON.parse(oldSeries!.subjects)).toEqual(['Fantasy', 'Magic']);
  expect(oldSeries!.totalPages).toBe(150);

  const newSeries = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'New Series' } });
  expect(newSeries).not.toBeNull();
  expect(newSeries!.bookCount).toBe(1);
  expect(JSON.parse(newSeries!.subjects)).toEqual(['Horror']);
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
cd app/server && npm test -- --testPathPattern=book-store --testNamePattern="reimportBook.*series|series.*reimport"
```

Expected: FAIL.

- [ ] **Step 3: Update `reimportBook` to call `recomputeSeriesMeta`**

Inside `reimportBook`'s `$transaction`, add recompute calls after the existing series cleanup block. The block that currently ends with:

```typescript
// Clean up the old Series row if it now has no books
if (oldSeriesId && oldSeriesId !== newSeriesId) {
  const remaining = await tx.book.count({ where: { seriesId: oldSeriesId } });
  if (remaining === 0) {
    await tx.series.delete({ where: { id: oldSeriesId } });
  }
}
```

Should become:

```typescript
// Clean up the old Series row if it now has no books; recompute if it still has some
if (oldSeriesId && oldSeriesId !== newSeriesId) {
  const remaining = await tx.book.count({ where: { seriesId: oldSeriesId } });
  if (remaining === 0) {
    await tx.series.delete({ where: { id: oldSeriesId } });
  } else {
    await this.recomputeSeriesMeta(tx, oldSeriesId);
  }
}

// Recompute the new series aggregates
if (newSeriesId) {
  await this.recomputeSeriesMeta(tx, newSeriesId);
}
```

- [ ] **Step 4: Run the tests to see them pass**

```bash
cd app/server && npm test -- --testPathPattern=book-store --testNamePattern="series aggregate"
```

Expected: All tests pass.

- [ ] **Step 5: Run the full book-store suite**

```bash
cd app/server && npm test -- --testPathPattern=book-store
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: recompute series meta in reimportBook"
```

---

## Task 4: `deleteBook` integration

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the `series aggregate metadata` describe block:

```typescript
it('updates series meta after deleting one book when others remain', async () => {
  await bookStore.addBook(OWNER, 'b1', stage('b1'), {
    ...FAKE_META,
    series: 'Dune',
    subjects: ['Science Fiction'],
    author: 'Frank Herbert',
    pageCount: 100,
  });
  await bookStore.addBook(OWNER, 'b2', stage('b2'), {
    ...FAKE_META,
    series: 'Dune',
    seriesIndex: 2,
    subjects: ['Science Fiction', 'Politics'],
    author: 'Frank Herbert',
    pageCount: 200,
  });

  await bookStore.deleteBook(OWNER, 'b1');

  const series = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'Dune' } });
  expect(series).not.toBeNull();
  expect(series!.bookCount).toBe(1);
  expect(series!.totalPages).toBe(200);
  expect(JSON.parse(series!.subjects)).toEqual(['Politics', 'Science Fiction']);
});

it('deletes the series when the last book is deleted', async () => {
  await bookStore.addBook(OWNER, 'b1', stage('b1'), {
    ...FAKE_META,
    series: 'Dune',
  });

  await bookStore.deleteBook(OWNER, 'b1');

  const series = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'Dune' } });
  expect(series).toBeNull();
});
```

- [ ] **Step 2: Run the tests to see them fail (the delete-last-book test may already pass)**

```bash
cd app/server && npm test -- --testPathPattern=book-store --testNamePattern="series aggregate"
```

Expected: The "updates series meta after deleting one book" test fails; the delete-last-book test passes (existing behaviour).

- [ ] **Step 3: Update `deleteBook` to call `recomputeSeriesMeta`**

Inside `deleteBook`'s `$transaction`, the block that currently reads:

```typescript
if (seriesId) {
  const remaining = await tx.book.count({ where: { seriesId } });
  if (remaining === 0) {
    await tx.series.delete({ where: { id: seriesId } });
  }
}
```

Should become:

```typescript
if (seriesId) {
  const remaining = await tx.book.count({ where: { seriesId } });
  if (remaining === 0) {
    await tx.series.delete({ where: { id: seriesId } });
  } else {
    await this.recomputeSeriesMeta(tx, seriesId);
  }
}
```

- [ ] **Step 4: Run all series aggregate tests**

```bash
cd app/server && npm test -- --testPathPattern=book-store --testNamePattern="series aggregate"
```

Expected: All tests pass.

- [ ] **Step 5: Run the full suite**

```bash
cd app/server && npm test -- --testPathPattern=book-store
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: recompute series meta in deleteBook"
```

---

## Task 5: Data migration backfill

**Files:**
- Modify: `app/server/db/migrate.ts`

- [ ] **Step 1: Write a failing test for the backfill**

Add a new `describe` block at the end of `app/server/db/migrate.test.ts`:

```typescript
describe('data_v13_series_meta backfill', () => {
  let tmpDir: string;
  let booksDir: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-v13-'));
    booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('backfills aggregate fields for existing series', async () => {
    // Run migrations to establish the full modern schema
    await runMigrations(prisma, booksDir);

    // Directly insert a user, series, and two books bypassing BookStore
    // (simulates data that existed before this migration ran)
    await prisma.$executeRaw`INSERT INTO users (id, username) VALUES ('u1', 'alice')`;
    await prisma.$executeRaw`
      INSERT INTO series (id, user_id, name, sort_key)
      VALUES ('s1', 'u1', 'Dune', 'Dune')
    `;
    await prisma.$executeRaw`
      INSERT INTO books (user_id, id, title, series, series_index, series_id,
        subjects, author, publisher, page_count, size, mtime, added_at)
      VALUES
        ('u1', 'b1', 'Dune', 'Dune', 1, 's1',
         '["Science Fiction","Space Opera"]', 'Frank Herbert', 'Chilton', 412, 1, 0, 0),
        ('u1', 'b2', 'Dune Messiah', 'Dune', 2, 's1',
         '["science fiction","Politics"]', 'frank herbert', 'Chilton', 256, 1, 0, 0)
    `;

    // Delete the data_v13_series_meta record so it runs again
    await prisma.$executeRaw`
      DELETE FROM _prisma_migrations WHERE migration_name = 'data_v13_series_meta'
    `;

    await runMigrations(prisma, booksDir);

    const series = await prisma.$queryRaw<Array<{
      book_count: number; author: string; publisher: string;
      total_pages: number; subjects: string;
    }>>`SELECT book_count, author, publisher, total_pages, subjects FROM series WHERE id = 's1'`;

    expect(series[0].book_count).toBe(2);
    expect(series[0].author).toBe('Frank Herbert'); // first-seen casing
    expect(series[0].publisher).toBe('Chilton');
    expect(series[0].total_pages).toBe(668);
    const subjects = JSON.parse(series[0].subjects) as string[];
    // case-insensitive dedup: 'science fiction' merges with 'Science Fiction'
    expect(subjects).toContain('Science Fiction');
    expect(subjects).toContain('Politics');
    expect(subjects).toHaveLength(3); // Space Opera, Science Fiction, Politics
  });

  it('does not run twice', async () => {
    await runMigrations(prisma, booksDir);
    await runMigrations(prisma, booksDir);
    // No error = idempotent
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

```bash
cd app/server && npm test -- --testPathPattern=migrate --testNamePattern="data_v13"
```

Expected: FAIL — series aggregate fields remain at defaults after second run.

- [ ] **Step 3: Add `data_v13_series_meta` to `migrate.ts`**

Add at the end of `runMigrations`, after the `data_v12_series_table` block:

```typescript
// Data migration: backfill series aggregate fields (bookCount, subjects, author,
// publisher, totalPages) for series rows that existed before these columns were added.
await runDataMigration(prisma, 'data_v13_series_meta', async () => {
  const allSeries = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM series`;
  for (const { id: seriesId } of allSeries) {
    const books = await prisma.$queryRaw<
      Array<{ subjects: string; author: string; publisher: string; page_count: number }>
    >`SELECT subjects, author, publisher, page_count FROM books WHERE series_id = ${seriesId}`;

    const bookCount = books.length;
    const totalPages = books.reduce((sum, b) => sum + b.page_count, 0);

    const seenSubjects = new Map<string, string>();
    for (const book of books) {
      for (const s of JSON.parse(book.subjects) as string[]) {
        const key = s.toLowerCase();
        if (!seenSubjects.has(key)) seenSubjects.set(key, s);
      }
    }
    const subjects = JSON.stringify([...seenSubjects.values()].sort((a, b) => a.localeCompare(b)));

    const seenAuthors = new Map<string, string>();
    for (const book of books) {
      if (book.author) {
        const key = book.author.toLowerCase();
        if (!seenAuthors.has(key)) seenAuthors.set(key, book.author);
      }
    }
    const author = [...seenAuthors.values()].join(', ');

    const seenPublishers = new Map<string, string>();
    for (const book of books) {
      if (book.publisher) {
        const key = book.publisher.toLowerCase();
        if (!seenPublishers.has(key)) seenPublishers.set(key, book.publisher);
      }
    }
    const publisher = [...seenPublishers.values()].join(', ');

    await prisma.$executeRaw`
      UPDATE series
      SET subjects = ${subjects},
          book_count = ${bookCount},
          author = ${author},
          publisher = ${publisher},
          total_pages = ${totalPages}
      WHERE id = ${seriesId}
    `;
  }
  if (allSeries.length > 0) {
    log.info(`Data migration (series meta): backfilled ${allSeries.length} series`);
  }
});
```

- [ ] **Step 4: Run the migration test**

```bash
cd app/server && npm test -- --testPathPattern=migrate --testNamePattern="data_v13"
```

Expected: All tests pass.

- [ ] **Step 5: Run the full server test suite**

```bash
cd app/server && npm test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/server/db/migrate.ts app/server/db/migrate.test.ts
git commit -m "feat: backfill series aggregate fields in data_v13_series_meta"
```

---

## Task 6: `getSeriesByName` + `GET /api/series/:name`

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/routes/ui.ts`
- Modify: `app/server/routes/ui.test.ts`

- [ ] **Step 1: Write failing tests for the API route**

Add a new `describe` block in `app/server/routes/ui.test.ts`:

```typescript
describe('GET /api/series/:name', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/series/Dune');
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown series', async () => {
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/series/NonExistent')
      .set(...bearer(token));
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe('Series not found');
  });

  it('returns aggregate fields for a known series', async () => {
    const token = await loginAlice();
    fs.mkdirSync(path.join(booksDir, 'alice'), { recursive: true });
    await bookStore.addBook(aliceOwner, 'bk1', stage('bk1'), {
      ...FAKE_META,
      series: 'Dune',
      subjects: ['Science Fiction'],
      author: 'Frank Herbert',
      publisher: 'Chilton',
      pageCount: 412,
    });
    await bookStore.addBook(aliceOwner, 'bk2', stage('bk2'), {
      ...FAKE_META,
      series: 'Dune',
      seriesIndex: 2,
      subjects: ['Science Fiction', 'Politics'],
      author: 'Frank Herbert',
      publisher: 'Chilton',
      pageCount: 256,
    });

    const res = await request(app)
      .get('/api/series/Dune')
      .set(...bearer(token));

    expect(res.status).toBe(200);
    const body = res.body as {
      name: string; subjects: string[]; bookCount: number;
      author: string; publisher: string; totalPages: number;
    };
    expect(body.name).toBe('Dune');
    expect(body.bookCount).toBe(2);
    expect(body.author).toBe('Frank Herbert');
    expect(body.publisher).toBe('Chilton');
    expect(body.totalPages).toBe(668);
    expect(body.subjects).toContain('Science Fiction');
    expect(body.subjects).toContain('Politics');
    expect(body.subjects).toHaveLength(2);
  });

  it('admin requires ?user= parameter', async () => {
    const token = await loginAdmin();
    const res = await request(app)
      .get('/api/series/Dune')
      .set(...bearer(token));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
cd app/server && npm test -- --testPathPattern=ui --testNamePattern="GET /api/series"
```

Expected: FAIL — 404 on all routes (route doesn't exist yet).

- [ ] **Step 3: Add `getSeriesByName` to `BookStore`**

Add this public method to `BookStore` (after `getMissingThumbnailPairs`, before `scan`):

```typescript
async getSeriesByName(
  owner: Owner,
  name: string
): Promise<{
  name: string;
  subjects: string[];
  bookCount: number;
  author: string;
  publisher: string;
  totalPages: number;
} | null> {
  const row = await this.prisma.series.findUnique({
    where: { userId_name: { userId: owner.userId, name } },
    select: {
      name: true,
      subjects: true,
      bookCount: true,
      author: true,
      publisher: true,
      totalPages: true,
    },
  });
  if (!row) return null;
  return {
    name: row.name,
    subjects: JSON.parse(row.subjects) as string[],
    bookCount: row.bookCount,
    author: row.author,
    publisher: row.publisher,
    totalPages: row.totalPages,
  };
}
```

- [ ] **Step 4: Add `GET /api/series/:name` to `ui.ts`**

Add this route in `ui.ts` immediately before the `router.delete('/api/books/:id', ...)` handler (after the existing book routes):

```typescript
router.get('/api/series/:name', requireAuth, async (req: Request, res: Response) => {
  const owner = await resolveOwner(req, res);
  if (!owner) return;
  const series = await bookStore.getSeriesByName(owner, req.params.name);
  if (!series) {
    res.status(404).json({ error: 'Series not found' });
    return;
  }
  res.json(series);
});
```

- [ ] **Step 5: Run the API tests**

```bash
cd app/server && npm test -- --testPathPattern=ui --testNamePattern="GET /api/series"
```

Expected: All 4 tests pass.

- [ ] **Step 6: Run the full server test suite**

```bash
cd app/server && npm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/server/services/book-store.ts app/server/routes/ui.ts app/server/routes/ui.test.ts
git commit -m "feat: add getSeriesByName and GET /api/series/:name"
```

---

## Task 7: Client `useSeries` hook

**Files:**
- Create: `app/client/src/provider/book/hook/use-series.ts`
- Create: `app/client/src/provider/book/hook/use-series.test.ts`
- Modify: `app/client/src/provider/book/hook/index.ts`
- Modify: `app/client/src/provider/book/index.ts`

- [ ] **Step 1: Write the failing test**

Create `app/client/src/provider/book/hook/use-series.test.ts`:

```typescript
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSeries } from './use-series';

vi.mock('~/provider/library-target', () => ({
  useWithTargetUser: () => (url: string) => url,
}));

const makeMeta = () => ({
  name: 'Dune',
  subjects: ['Science Fiction', 'Politics'],
  bookCount: 2,
  author: 'Frank Herbert',
  publisher: 'Chilton',
  totalPages: 668,
});

describe('useSeries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts in loading state', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() => useSeries('Dune'));
    const [data, loading, error] = result.current;
    expect(data).toBeUndefined();
    expect(loading).toBe(true);
    expect(error).toBe(false);
  });

  it('returns series data on successful fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeMeta()),
      })
    );

    const { result } = renderHook(() => useSeries('Dune'));
    await act(async () => {});

    const [data, loading, error] = result.current;
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(data?.name).toBe('Dune');
    expect(data?.bookCount).toBe(2);
    expect(data?.subjects).toEqual(['Science Fiction', 'Politics']);
    expect(data?.author).toBe('Frank Herbert');
    expect(data?.publisher).toBe('Chilton');
    expect(data?.totalPages).toBe(668);
  });

  it('returns error state when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useSeries('Dune'));
    await act(async () => {});

    const [data, loading, error, errorMessage] = result.current;
    expect(data).toBeUndefined();
    expect(loading).toBe(false);
    expect(error).toBe(true);
    expect(errorMessage).toBe('Series not found');
  });

  it('returns error state when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const { result } = renderHook(() => useSeries('Dune'));
    await act(async () => {});

    const [, , error, errorMessage] = result.current;
    expect(error).toBe(true);
    expect(errorMessage).toBe('Network error');
  });

  it('re-fetches when seriesName changes', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeMeta()),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result, rerender } = renderHook(({ name }) => useSeries(name), {
      initialProps: { name: 'Dune' },
    });
    await act(async () => {});
    expect(mockFetch).toHaveBeenCalledTimes(1);

    rerender({ name: 'Foundation' });
    await act(async () => {});
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

```bash
cd app/client && npm test -- use-series
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `use-series.ts`**

Create `app/client/src/provider/book/hook/use-series.ts`:

```typescript
import { useState, useEffect } from 'react';

import { apiFetch } from '~/lib/api-fetch';
import { useWithTargetUser } from '~/provider/library-target';

export type SeriesMeta = {
  name: string;
  subjects: string[];
  bookCount: number;
  author: string;
  publisher: string;
  totalPages: number;
};

export type UseSeries =
  | [SeriesMeta, false, false, undefined]
  | [undefined, true, false, undefined]
  | [undefined, false, true, undefined]
  | [undefined, false, true, string];

export const useSeries = (seriesName: string): UseSeries => {
  const [data, setData] = useState<SeriesMeta | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const withTargetUser = useWithTargetUser();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setData(undefined);
    void apiFetch(withTargetUser(`/api/series/${encodeURIComponent(seriesName)}`))
      .then(async (res) => {
        if (!res.ok) throw new Error('Series not found');
        const meta = await (res.json() as Promise<SeriesMeta>);
        if (!cancelled) setData(meta);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [seriesName, withTargetUser]);

  if (error !== undefined) return [undefined, false, true, error];
  if (data !== undefined) return [data, false, false, undefined];
  return [undefined, true, false, undefined];
};
```

- [ ] **Step 4: Run the tests**

```bash
cd app/client && npm test -- use-series
```

Expected: All 5 tests pass.

- [ ] **Step 5: Export from `hook/index.ts` and `provider/book/index.ts`**

In `app/client/src/provider/book/hook/index.ts`, add these two lines alongside the existing exports:

```typescript
export { useSeries } from './use-series';
export type { SeriesMeta } from './use-series';
```

In `app/client/src/provider/book/index.ts`, add `useSeries` to the existing named `export { ... } from './hook'` block (keep all existing entries, insert `useSeries` in alphabetical order):

```typescript
export {
  useBook,
  useBookLineage,
  useBookList,
  useBookListItems,
  useDeleteBook,
  useFetchBook,
  useFetchBookList,
  useFetchNextPage,
  usePatchBookMetadata,
  useRegenChapters,
  useScanLibrary,
  useSeries,
  useSeriesBookList,
  useSeriesList,
  useStandaloneBookList,
  useUnlinkBookLineage,
  useUploadBookList,
  useUploadQueue,
} from './hook';
```

Then add a separate type-only export line for `SeriesMeta` (the existing types come from `'./type'`, `SeriesMeta` lives in `'./hook'`):

```typescript
export type { SeriesMeta } from './hook';
```

- [ ] **Step 6: Run the full client test suite**

```bash
cd app/client && npm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/provider/book/hook/use-series.ts app/client/src/provider/book/hook/use-series.test.ts app/client/src/provider/book/hook/index.ts app/client/src/provider/book/index.ts
git commit -m "feat: add useSeries hook"
```

---

## Task 8: Series page update

**Files:**
- Modify: `app/client/src/page/series/index.tsx`

- [ ] **Step 1: Update the series page**

Replace the entire contents of `app/client/src/page/series/index.tsx` with:

```typescript
import { useParams } from 'react-router-dom';

import {
  Card,
  CoverStack,
  BookRow,
  Page,
  ProgressIndicator,
  MetadataList,
  Metadata,
  Tag,
} from '~/component';
import { useIsAdmin } from '~/provider/auth';
import { useSeries, useSeriesBookList } from '~/provider/book';
import { useMySeriesProgress } from '~/provider/progress';

import { useStyle } from './style';

export const SeriesPage = () => {
  const { name } = useParams<{ name: string }>();
  const style = useStyle();

  const [isAdmin] = useIsAdmin();
  const [seriesBookList, booksLoading, booksError] = useSeriesBookList(name!);
  const [series, seriesLoading, seriesError] = useSeries(name!);
  const [seriesProgressPercent] = useMySeriesProgress(name!);

  const loading = booksLoading || seriesLoading;
  const error = booksError || seriesError;

  if (loading) {
    return (
      <Page>
        <Card>
          <p className={style.loading}>Loading…</p>
        </Card>
      </Page>
    );
  }

  if (error || !seriesBookList || seriesBookList.length === 0 || !series) {
    return (
      <Page>
        <Card>
          <p className={style.notFound}>Series not found.</p>
        </Card>
      </Page>
    );
  }

  const metadata: Metadata[] = [];
  if (!isAdmin) {
    metadata.push({
      title: 'progress',
      value: (
        <ProgressIndicator value={seriesProgressPercent ? seriesProgressPercent : 0} size={12} />
      ),
    });
  }
  metadata.push({ title: 'books', value: series.bookCount });
  if (series.totalPages > 0) {
    metadata.push({ title: 'pages', value: series.totalPages });
  }
  if (series.publisher) {
    metadata.push({ title: 'publisher', value: series.publisher });
  }

  return (
    <Page>
      <Card>
        <div className={style.cardContainer}>
          <div className={style.hero}>
            <CoverStack
              seriesName={name!}
              containerWidth={100}
              containerHeight={130}
              layerWidth={80}
              layerHeight={118}
            />
            <div>
              <h1 className={style.title}>{name}</h1>
              <div className={style.author}>{series.author}</div>
            </div>
          </div>
          <div className={style.metadata}>
            <MetadataList metadata={metadata} />
          </div>
        </div>
      </Card>
      <Card title="Books">
        <div className={style.bookList}>
          {seriesBookList.map((book) => (
            <BookRow key={book.id} asCard={false} bookId={book.id} showAuthor={false} />
          ))}
        </div>
      </Card>
      {series.subjects.length > 0 && (
        <Card title="Subjects">
          <div className={style.subjects}>
            {series.subjects.map((subject, index) => (
              <Tag key={subject + index}>{subject}</Tag>
            ))}
          </div>
        </Card>
      )}
    </Page>
  );
};
```

- [ ] **Step 2: Add `subjects` style to `app/client/src/page/series/style.ts`**

The file currently ends with the `metadata` entry. Add a `subjects` entry before the closing `}));`:

```typescript
  subjects: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.space.md,
  },
```

- [ ] **Step 3: Type-check the client**

```bash
cd app/client && npm run type
```

Expected: No type errors.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

From the repo root. Expected: All tests pass.

- [ ] **Step 5: Run lint**

```bash
npm run lint
```

Expected: No lint errors.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/page/series/index.tsx app/client/src/page/series/style.ts
git commit -m "feat: show series aggregate metadata and subjects card on series page"
```

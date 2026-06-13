# Library Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Series` table and paginated `GET /api/books` endpoint, then wire the client to infinite-scroll 20 display units at a time.

**Architecture:** A new `series` DB table acts as an index of display units; `BookStore` maintains it in sync with every `addBook`/`reimportBook`/`deleteBook`. The existing `/api/books` endpoint gains an optional `?cursor&take` variant that two-query merges standalone books and series rows into an ordered page. On the client, `BookProvider` stores `bookListItems` (ordered display units) alongside the existing flat `bookList` dict; an `IntersectionObserver` sentinel in `LibraryPage` triggers `useFetchNextPage` as the user scrolls.

**Tech Stack:** SQLite (via Prisma + better-sqlite3 3.53), Express, React, Vitest (client), Jest (server).

---

## File Map

### New files
- `app/server/prisma/migrations/20260613200000_add_series_table/migration.sql`
- `app/client/src/provider/book/hook/use-fetch-next-page.ts`
- `app/client/src/provider/book/hook/use-fetch-next-page.test.tsx`
- `app/client/src/provider/book/hook/use-book-list-items.ts`

### Modified files
- `app/server/prisma/schema.prisma` — add `Series` model; add `seriesId`/`seriesRel` to `Book`; add `series Series[]` to `User`
- `app/server/types.ts` — add `BookSummary`, `PagedBookListResponse`
- `app/server/services/book-store.ts` — `addBook`, `reimportBook`, `deleteBook` maintain Series; add `listBooksPage`
- `app/server/services/book-store.test.ts` — Series lifecycle + `listBooksPage` tests
- `app/server/routes/ui.ts` — paginated branch in `GET /api/books`
- `app/server/routes/ui.test.ts` — paginated route tests
- `app/client/src/provider/book/type.ts` — add `DisplayUnit`, `PagedBookListResponse`
- `app/client/src/provider/book/context.ts` — add `bookListItems`, `nextCursor`, setters
- `app/client/src/provider/book/provider.tsx` — add state for new context fields
- `app/client/src/provider/book/hook/use-fetch-book-list.ts` — fetch paginated endpoint
- `app/client/src/provider/book/hook/use-fetch-book-list.test.tsx` — update for new response shape
- `app/client/src/provider/book/hook/use-book-list.ts` — reset `bookListItems`/`nextCursor` on target change
- `app/client/src/provider/book/hook/use-book-list.test.tsx` — update fetch mock shape
- `app/client/src/provider/book/hook/index.ts` — export new hooks
- `app/client/src/provider/book/index.ts` — export `useFetchNextPage`, `useBookListItems`, `DisplayUnit`
- `app/client/src/page/library/index.tsx` — use `bookListItems` + `IntersectionObserver` sentinel

---

## Task 1: Prisma schema + migration SQL

**Files:**
- Modify: `app/server/prisma/schema.prisma`
- Create: `app/server/prisma/migrations/20260613200000_add_series_table/migration.sql`

- [ ] **Step 1: Add `Series` model and `seriesId` FK to `schema.prisma`**

Replace the `Book` model block and add `Series` and update `User`:

```prisma
model Book {
  userId          String          @map("user_id")
  id              String
  title           String
  fileAs          String          @default("") @map("file_as")
  author          String          @default("")
  description     String          @default("")
  publisher       String          @default("")
  series          String          @default("")
  seriesIndex     Float           @default(0) @map("series_index")
  seriesId        String?         @map("series_id")
  identifiers     String          @default("[]")
  subjects        String          @default("[]")
  coverData       Bytes?          @map("cover_data")
  coverMime       String?         @map("cover_mime")
  size            Int
  mtime           Float
  addedAt         Float           @map("added_at")
  chapterCount    Int             @default(0) @map("chapter_count")
  chapterSpineMap String          @default("[]") @map("chapter_spine_map")
  chapterNames    String?         @map("chapter_names")
  pageCount       Int             @default(0) @map("page_count")
  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  seriesRel       Series?         @relation(fields: [seriesId], references: [id], onDelete: SetNull)
  thumbnails      BookThumbnail[]

  @@id([userId, id])
  @@map("books")
}

model Series {
  id      String @id
  userId  String @map("user_id")
  name    String
  sortKey String @map("sort_key")
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  books   Book[]

  @@unique([userId, name])
  @@map("series")
}
```

Add `series Series[]` to the `User` model:
```prisma
model User {
  id                 String            @id
  username           String            @unique
  passwordHash       String?           @map("password_hash")
  syncPassword       String?           @map("sync_password")
  mustChangePassword Boolean           @default(false) @map("must_change_password")
  progresses         Progress[]
  progressHistories  ProgressHistory[]
  refreshTokens      RefreshToken[]
  books              Book[]
  series             Series[]

  @@map("users")
}
```

- [ ] **Step 2: Create the migration SQL file**

Create `app/server/prisma/migrations/20260613200000_add_series_table/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "series" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_key" TEXT NOT NULL,
    CONSTRAINT "series_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "series_user_id_name_key" ON "series"("user_id", "name");

-- AlterTable: add series_id FK to books (SQLite 3.35+ supports REFERENCES in ADD COLUMN)
ALTER TABLE "books" ADD COLUMN "series_id" TEXT REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: create Series rows for all existing books with a non-empty series string
INSERT INTO "series" ("id", "user_id", "name", "sort_key")
SELECT lower(hex(randomblob(16))), "user_id", "series", "series"
FROM "books"
WHERE "series" != ''
GROUP BY "user_id", "series";

-- Update books.series_id to point to their series row
UPDATE "books"
SET "series_id" = (
    SELECT "id" FROM "series"
    WHERE "series"."user_id" = "books"."user_id"
      AND "series"."name" = "books"."series"
)
WHERE "series" != '';
```

- [ ] **Step 3: Regenerate the Prisma client**

```bash
cd app/server && npx prisma generate
```

Expected: `Generated Prisma Client` output, no errors.

- [ ] **Step 4: Commit**

```bash
git add app/server/prisma/schema.prisma app/server/prisma/migrations/20260613200000_add_series_table/migration.sql
git commit -m "feat: add Series table schema and migration"
```

---

## Task 2: BookStore — Series upsert in `addBook`

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe('Series lifecycle — addBook')` block in `book-store.test.ts` (place it after the `addBook and listBooks` describe block):

```typescript
describe('Series lifecycle — addBook', () => {
  it('creates a Series row when a book is added with a series name', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, series: 'Dune' });
    const row = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Dune' } },
    });
    expect(row).not.toBeNull();
    expect(row!.name).toBe('Dune');
    expect(row!.sortKey).toBe('Dune');
  });

  it('sets seriesId on the book to point at the Series row', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, series: 'Dune' });
    const book = await prisma.book.findUnique({
      where: { userId_id: { userId: OWNER.userId, id: 'b1' } },
      select: { seriesId: true },
    });
    const row = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Dune' } },
    });
    expect(book!.seriesId).toBe(row!.id);
  });

  it('does not create a Series row when series name is empty', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, series: '' });
    const count = await prisma.series.count({ where: { userId: OWNER.userId } });
    expect(count).toBe(0);
  });

  it('reuses the same Series row for two books in the same series', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, series: 'Dune' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, series: 'Dune' });
    const count = await prisma.series.count({
      where: { userId: OWNER.userId, name: 'Dune' },
    });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd app/server && npm test -- --testPathPattern="book-store"
```

Expected: `Series lifecycle — addBook` tests fail (TypeError or Prisma unknown field).

- [ ] **Step 3: Add `randomUUID` import and update `addBook` in `book-store.ts`**

Add to the import block at the top of `book-store.ts`:
```typescript
import { randomUUID } from 'crypto';
```

In the `addBook` method, insert the series upsert before `this.prisma.book.create(...)`:

```typescript
async addBook(owner: Owner, id: string, srcPath: string, meta: EpubMeta): Promise<void> {
  const existing = await this.prisma.book.findUnique({
    where: { userId_id: { userId: owner.userId, id } },
    select: { id: true },
  });
  if (existing) {
    throw new BookAlreadyExistsError(id);
  }

  fs.mkdirSync(this.getUserDir(owner), { recursive: true });
  const targetPath = this.bookPath(owner, id);
  if (path.resolve(srcPath) !== path.resolve(targetPath)) {
    fs.renameSync(srcPath, targetPath);
  }

  const stat = fs.statSync(targetPath);
  const title = meta.title.trim();
  const fileAs = (meta.fileAs || '').trim();

  let seriesId: string | null = null;
  const seriesName = meta.series.trim();
  if (seriesName) {
    const s = await this.prisma.series.upsert({
      where: { userId_name: { userId: owner.userId, name: seriesName } },
      create: { id: randomUUID(), userId: owner.userId, name: seriesName, sortKey: seriesName },
      update: {},
      select: { id: true },
    });
    seriesId = s.id;
  }

  await this.prisma.book.create({
    data: {
      userId: owner.userId,
      id,
      title,
      fileAs,
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
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd app/server && npm test -- --testPathPattern="book-store"
```

Expected: `Series lifecycle — addBook` 4 tests pass. No regressions in existing book-store tests.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: upsert Series row in BookStore.addBook"
```

---

## Task 3: BookStore — Series sync in `reimportBook`

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

- [ ] **Step 1: Write failing tests**

Add after the `Series lifecycle — addBook` describe block:

```typescript
describe('Series lifecycle — reimportBook', () => {
  function makeImporterWithMeta(meta: Partial<EpubMeta>): ScanImporter {
    return {
      parseEpub: () => ({ ...FAKE_META, ...meta }),
      partialMD5: (fp) => require('crypto').createHash('md5').update(fp).digest('hex'),
    };
  }

  it('upserts a new Series when series name changes', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), { ...FAKE_META, series: 'Old' });
    const importer = makeImporterWithMeta({ series: 'New' });
    await bookStore.reimportBook(OWNER, 'id1', importer);
    const newRow = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'New' } },
    });
    expect(newRow).not.toBeNull();
  });

  it('deletes the old Series when series name changes and it has no other books', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), { ...FAKE_META, series: 'Old' });
    const importer = makeImporterWithMeta({ series: 'New' });
    await bookStore.reimportBook(OWNER, 'id1', importer);
    const oldRow = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Old' } },
    });
    expect(oldRow).toBeNull();
  });

  it('keeps the old Series when another book still belongs to it', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), { ...FAKE_META, series: 'Old' });
    await bookStore.addBook(OWNER, 'id2', stage('id2'), { ...FAKE_META, series: 'Old' });
    const importer = makeImporterWithMeta({ series: 'New' });
    await bookStore.reimportBook(OWNER, 'id1', importer);
    const oldRow = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Old' } },
    });
    expect(oldRow).not.toBeNull();
  });

  it('clears seriesId when series name becomes empty', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), { ...FAKE_META, series: 'Old' });
    const importer = makeImporterWithMeta({ series: '' });
    await bookStore.reimportBook(OWNER, 'id1', importer);
    const book = await prisma.book.findUnique({
      where: { userId_id: { userId: OWNER.userId, id: 'id1' } },
      select: { seriesId: true },
    });
    expect(book!.seriesId).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd app/server && npm test -- --testPathPattern="book-store" --testNamePattern="Series lifecycle"
```

Expected: the 4 new `reimportBook` tests fail.

- [ ] **Step 3: Update `reimportBook` in `book-store.ts`**

Expand the initial `findUnique` to also select `series` and `seriesId`, and add the series sync inside the transaction for both branches. Show the full updated method:

```typescript
async reimportBook(
  owner: Owner,
  id: string,
  importer: ScanImporter = defaultImporter
): Promise<Book | null> {
  const exists = await this.prisma.book.findUnique({
    where: { userId_id: { userId: owner.userId, id } },
    select: { id: true, series: true, seriesId: true },
  });
  if (!exists) return null;
  const oldSeriesId = exists.seriesId;

  const filePath = this.bookPath(owner, id);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  const meta = importer.parseEpub(filePath);
  const newId = importer.partialMD5(filePath);

  if (newId !== id) {
    const collision = await this.prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id: newId } },
      select: { id: true },
    });
    if (collision) {
      throw new BookHashCollisionError(newId);
    }
  }

  await this.prisma.$transaction(async (tx) => {
    // Resolve new seriesId
    let newSeriesId: string | null = null;
    const newSeriesName = meta.series.trim();
    if (newSeriesName) {
      const s = await tx.series.upsert({
        where: { userId_name: { userId: owner.userId, name: newSeriesName } },
        create: { id: randomUUID(), userId: owner.userId, name: newSeriesName, sortKey: newSeriesName },
        update: {},
        select: { id: true },
      });
      newSeriesId = s.id;
    }

    if (newId !== id) {
      const oldPath = this.bookPath(owner, id);
      const newPath = this.bookPath(owner, newId);
      if (oldPath !== newPath) {
        fs.renameSync(oldPath, newPath);
      }

      await tx.book.update({
        where: { userId_id: { userId: owner.userId, id } },
        data: {
          id: newId,
          title: meta.title.trim(),
          fileAs: (meta.fileAs || '').trim(),
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
          chapterCount: meta.chapterCount,
          chapterSpineMap: JSON.stringify(meta.chapterSpineMap),
          chapterNames: JSON.stringify(meta.chapterNames),
          pageCount: meta.pageCount,
          seriesId: newSeriesId,
        },
      });

      const oldProgress = await tx.progress.findUnique({
        where: { userId_document: { userId: owner.userId, document: id } },
      });
      if (oldProgress) {
        const newProgress = await tx.progress.findUnique({
          where: { userId_document: { userId: owner.userId, document: newId } },
        });
        if (!newProgress || oldProgress.timestamp >= newProgress.timestamp) {
          if (newProgress) {
            await tx.progress.delete({
              where: { userId_document: { userId: owner.userId, document: newId } },
            });
          }
          await tx.progress.delete({
            where: { userId_document: { userId: owner.userId, document: id } },
          });
          await tx.progress.create({ data: { ...oldProgress, document: newId } });
        } else {
          await tx.progress.delete({
            where: { userId_document: { userId: owner.userId, document: id } },
          });
        }
      }

      await tx.$executeRaw`
        INSERT OR REPLACE INTO book_id_history (user_id, old_id, current_id, timestamp)
        VALUES (${owner.userId}, ${id}, ${newId}, ${Date.now()})
      `;
      await tx.$executeRaw`
        UPDATE book_id_history SET current_id = ${newId}
        WHERE user_id = ${owner.userId} AND current_id = ${id}
      `;
    } else {
      await tx.book.update({
        where: { userId_id: { userId: owner.userId, id } },
        data: {
          title: meta.title.trim(),
          fileAs: (meta.fileAs || '').trim(),
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
          chapterCount: meta.chapterCount,
          chapterSpineMap: JSON.stringify(meta.chapterSpineMap),
          chapterNames: JSON.stringify(meta.chapterNames),
          pageCount: meta.pageCount,
          seriesId: newSeriesId,
        },
      });
    }

    // Clean up the old Series row if it now has no books
    if (oldSeriesId && oldSeriesId !== newSeriesId) {
      const remaining = await tx.book.count({ where: { seriesId: oldSeriesId } });
      if (remaining === 0) {
        await tx.series.delete({ where: { id: oldSeriesId } });
      }
    }
  });

  return this.getBookById(owner, newId);
}
```

- [ ] **Step 4: Run tests**

```bash
cd app/server && npm test -- --testPathPattern="book-store"
```

Expected: all book-store tests pass, including all Series lifecycle tests.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: sync Series row in BookStore.reimportBook"
```

---

## Task 4: BookStore — Series cleanup in `deleteBook`

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

- [ ] **Step 1: Write failing tests**

Add after the reimportBook series describe block:

```typescript
describe('Series lifecycle — deleteBook', () => {
  it('deletes the Series row when the last book in the series is deleted', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, series: 'Dune' });
    await bookStore.deleteBook(OWNER, 'b1');
    const row = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Dune' } },
    });
    expect(row).toBeNull();
  });

  it('keeps the Series row when another book still belongs to it', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, series: 'Dune' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, series: 'Dune' });
    await bookStore.deleteBook(OWNER, 'b1');
    const row = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Dune' } },
    });
    expect(row).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd app/server && npm test -- --testPathPattern="book-store" --testNamePattern="Series lifecycle — deleteBook"
```

Expected: both tests fail.

- [ ] **Step 3: Update `deleteBook` in `book-store.ts`**

```typescript
async deleteBook(owner: Owner, id: string): Promise<Book | null> {
  const book = await this.getBookById(owner, id);
  if (!book) return null;
  try {
    await this.prisma.$transaction(async (tx) => {
      // Capture seriesId before deleting the row
      const bookRow = await tx.book.findUnique({
        where: { userId_id: { userId: owner.userId, id } },
        select: { seriesId: true },
      });
      const seriesId = bookRow?.seriesId ?? null;

      try {
        await tx.book.delete({ where: { userId_id: { userId: owner.userId, id } } });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'))
          throw err;
      }
      await tx.$executeRaw`
        DELETE FROM book_id_history
        WHERE user_id = ${owner.userId} AND (old_id = ${id} OR current_id = ${id})
      `;

      if (seriesId) {
        const remaining = await tx.book.count({ where: { seriesId } });
        if (remaining === 0) {
          await tx.series.delete({ where: { id: seriesId } });
        }
      }
    });
  } finally {
    try {
      fs.unlinkSync(book.path);
    } catch {
      /* file already gone */
    }
  }
  return book;
}
```

- [ ] **Step 4: Run tests**

```bash
cd app/server && npm test -- --testPathPattern="book-store"
```

Expected: all book-store tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: clean up Series row in BookStore.deleteBook"
```

---

## Task 5: BookStore — `listBooksPage` method

**Files:**
- Modify: `app/server/types.ts`
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

- [ ] **Step 1: Add `BookSummary` and `PagedBookListResponse` to `types.ts`**

```typescript
// Add at the end of app/server/types.ts

export type BookSummary = Omit<
  Book,
  'path' | 'description' | 'identifiers' | 'subjects' | 'addedAt' | 'chapterSpineMap' | 'chapterNames'
>;

export type PagedBookListResponse = {
  items: Array<{ type: 'series'; seriesName: string } | { type: 'standalone'; bookId: string }>;
  books: BookSummary[];
  nextCursor: string | null;
};
```

- [ ] **Step 2: Write failing tests for `listBooksPage`**

Add a new describe block in `book-store.test.ts`:

```typescript
describe('BookStore.listBooksPage()', () => {
  it('returns empty result for an empty library', async () => {
    const result = await bookStore.listBooksPage(OWNER, '', 20);
    expect(result).toEqual({ items: [], books: [], nextCursor: null });
  });

  it('returns standalone books as display units', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Alpha', series: '' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'Beta', series: '' });
    const result = await bookStore.listBooksPage(OWNER, '', 20);
    expect(result.items).toEqual([
      { type: 'standalone', bookId: 'b1' },
      { type: 'standalone', bookId: 'b2' },
    ]);
    expect(result.books).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('returns a series as a single display unit', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Dune 1', series: 'Dune' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'Dune 2', series: 'Dune' });
    const result = await bookStore.listBooksPage(OWNER, '', 20);
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    expect(result.books).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('includes all series books in the books array even when only one item is a series', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'D1', series: 'Dune' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'D2', series: 'Dune' });
    const result = await bookStore.listBooksPage(OWNER, '', 20);
    const ids = result.books.map((b) => b.id).sort();
    expect(ids).toEqual(['b1', 'b2'].sort());
  });

  it('merges series and standalones in title/name order', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Apple', series: '' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'Cherry', series: 'Banana' });
    await bookStore.addBook(OWNER, 'b3', stage('b3'), { ...FAKE_META, title: 'Dates', series: '' });
    const result = await bookStore.listBooksPage(OWNER, '', 20);
    expect(result.items).toEqual([
      { type: 'standalone', bookId: 'b1' },
      { type: 'series', seriesName: 'Banana' },
      { type: 'standalone', bookId: 'b3' },
    ]);
  });

  it('returns nextCursor when take is less than total display units', async () => {
    for (let i = 1; i <= 5; i++) {
      await bookStore.addBook(OWNER, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Book ${String.fromCharCode(64 + i)}`,
        series: '',
      });
    }
    const result = await bookStore.listBooksPage(OWNER, '', 3);
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).not.toBeNull();
  });

  it('advances the cursor to load the next page', async () => {
    for (let i = 1; i <= 4; i++) {
      await bookStore.addBook(OWNER, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Book ${String.fromCharCode(64 + i)}`,
        series: '',
      });
    }
    const page1 = await bookStore.listBooksPage(OWNER, '', 2);
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await bookStore.listBooksPage(
      OWNER,
      Buffer.from(page1.nextCursor!, 'base64').toString('utf-8'),
      2
    );
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    const allIds = [...page1.items, ...page2.items].map((item) =>
      item.type === 'standalone' ? item.bookId : item.seriesName
    );
    expect(new Set(allIds).size).toBe(4);
  });
});
```

- [ ] **Step 3: Run to confirm failures**

```bash
cd app/server && npm test -- --testPathPattern="book-store" --testNamePattern="listBooksPage"
```

Expected: all `listBooksPage` tests fail (`bookStore.listBooksPage is not a function`).

- [ ] **Step 4: Implement `listBooksPage` in `book-store.ts`**

Add a private helper and the public method. Add just before `private prismaBookToBook(...)`:

```typescript
private toBookSummary(book: Book): BookSummary {
  const {
    path: _path,
    description: _description,
    identifiers: _identifiers,
    subjects: _subjects,
    addedAt: _addedAt,
    chapterSpineMap: _chapterSpineMap,
    chapterNames: _chapterNames,
    ...rest
  } = book;
  return rest;
}

async listBooksPage(owner: Owner, after: string, take: number): Promise<PagedBookListResponse> {
  const [seriesRows, standaloneRows] = await Promise.all([
    this.prisma.series.findMany({
      where: { userId: owner.userId, sortKey: { gt: after } },
      orderBy: { sortKey: 'asc' },
      take,
    }),
    this.prisma.book.findMany({
      where: { userId: owner.userId, seriesId: null, title: { gt: after } },
      orderBy: { title: 'asc' },
      take,
      select: BOOK_SELECT,
    }),
  ]);

  // Merge-sort: series before standalone on equal sort key
  const page: Array<
    | { sortKey: string; type: 'series'; row: (typeof seriesRows)[0] }
    | { sortKey: string; type: 'standalone'; row: (typeof standaloneRows)[0] }
  > = [];
  let si = 0;
  let bi = 0;
  while (page.length < take) {
    const s = seriesRows[si];
    const b = standaloneRows[bi];
    if (!s && !b) break;
    let pickSeries: boolean;
    if (!s) pickSeries = false;
    else if (!b) pickSeries = true;
    else pickSeries = s.sortKey.localeCompare(b.title) <= 0;
    if (pickSeries) {
      page.push({ sortKey: s.sortKey, type: 'series', row: s });
      si++;
    } else {
      page.push({ sortKey: b.title, type: 'standalone', row: b });
      bi++;
    }
  }

  // Fetch all member books for every series item
  const seriesBooksMap = new Map<string, Book[]>();
  await Promise.all(
    page
      .filter((p) => p.type === 'series')
      .map(async (p) => {
        const s = (p as { type: 'series'; row: (typeof seriesRows)[0] }).row;
        const rows = await this.prisma.book.findMany({
          where: { seriesId: s.id },
          select: BOOK_SELECT,
        });
        seriesBooksMap.set(s.name, rows.map((r) => this.prismaBookToBook(owner, r)));
      })
  );

  const items: PagedBookListResponse['items'] = page.map((p) =>
    p.type === 'series'
      ? { type: 'series' as const, seriesName: (p.row as (typeof seriesRows)[0]).name }
      : { type: 'standalone' as const, bookId: (p.row as (typeof standaloneRows)[0]).id }
  );

  const books: BookSummary[] = page.flatMap((p) => {
    if (p.type === 'standalone') {
      return [this.toBookSummary(this.prismaBookToBook(owner, p.row as (typeof standaloneRows)[0]))];
    }
    return (seriesBooksMap.get((p.row as (typeof seriesRows)[0]).name) ?? []).map((b) =>
      this.toBookSummary(b)
    );
  });

  const nextCursor =
    page.length === take
      ? Buffer.from(page[page.length - 1].sortKey).toString('base64')
      : null;

  return { items, books, nextCursor };
}
```

Also add the `BookSummary` and `PagedBookListResponse` imports to `book-store.ts`:

```typescript
import { Book, BookSummary, EpubMeta, Owner, PagedBookListResponse } from '../types';
```

- [ ] **Step 5: Run tests**

```bash
cd app/server && npm test -- --testPathPattern="book-store"
```

Expected: all book-store tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/server/types.ts app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: add BookStore.listBooksPage for paginated library queries"
```

---

## Task 6: API route — paginated `GET /api/books`

**Files:**
- Modify: `app/server/routes/ui.ts`
- Modify: `app/server/routes/ui.test.ts`

- [ ] **Step 1: Write failing route tests**

Add a new describe block in `ui.test.ts` after the existing `GET /api/books` describe:

```typescript
describe('GET /api/books (paginated)', () => {
  it('returns paginated shape when take param is present', async () => {
    await bookStore.addBook(aliceOwner, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books?take=20')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(Array.isArray(res.body.books)).toBe(true);
    expect(res.body).toHaveProperty('nextCursor');
  });

  it('places a series as a single item in the items array', async () => {
    await bookStore.addBook(aliceOwner, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
    });
    await bookStore.addBook(aliceOwner, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
    });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books?take=20')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    expect(res.body.books).toHaveLength(2);
  });

  it('returns nextCursor when more pages exist', async () => {
    for (let i = 1; i <= 3; i++) {
      await bookStore.addBook(aliceOwner, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Book ${String.fromCharCode(64 + i)}`,
        series: '',
      });
    }
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books?take=2')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.nextCursor).not.toBeNull();
  });

  it('advances with cursor to load the next page', async () => {
    for (let i = 1; i <= 4; i++) {
      await bookStore.addBook(aliceOwner, `p${i}`, stage(`p${i}`), {
        ...FAKE_META,
        title: `Book ${String.fromCharCode(64 + i)}`,
        series: '',
      });
    }
    const token = await loginAlice();
    const page1 = await request(app)
      .get('/api/books?take=2')
      .set(...bearer(token));
    const cursor = page1.body.nextCursor as string;
    const page2 = await request(app)
      .get(`/api/books?cursor=${encodeURIComponent(cursor)}&take=2`)
      .set(...bearer(token));
    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/books?take=20');
    expect(res.status).toBe(401);
  });

  it('non-paginated call (no params) still returns flat array', async () => {
    await bookStore.addBook(aliceOwner, 'flat1', stage('flat1'), { ...FAKE_META, title: 'Flat' });
    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books')
      .set(...bearer(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd app/server && npm test -- --testPathPattern="ui" --testNamePattern="paginated"
```

Expected: all paginated tests fail (route still returns flat array for any call).

- [ ] **Step 3: Update `GET /api/books` in `ui.ts`**

Replace the existing `router.get('/api/books', ...)` handler:

```typescript
router.get('/api/books', requireAuth, async (req: Request, res: Response) => {
  const owner = await resolveOwner(req, res);
  if (!owner) return;

  const { cursor, take } = req.query;

  if (cursor !== undefined || take !== undefined) {
    const after =
      typeof cursor === 'string' && cursor
        ? Buffer.from(cursor, 'base64').toString('utf-8')
        : '';
    const pageSize =
      typeof take === 'string'
        ? Math.min(Math.max(parseInt(take, 10) || 20, 1), 100)
        : 20;
    const result = await bookStore.listBooksPage(owner, after, pageSize);
    res.json(result);
    return;
  }

  res.json(
    (await bookStore.listBooks(owner)).map((b) => {
      const {
        path: _path,
        description: _description,
        identifiers: _identifiers,
        subjects: _subjects,
        addedAt: _addedAt,
        chapterSpineMap: _chapterSpineMap,
        chapterNames: _chapterNames,
        ...rest
      } = b;
      return rest;
    })
  );
});
```

- [ ] **Step 4: Run tests**

```bash
cd app/server && npm test -- --testPathPattern="ui"
```

Expected: all ui route tests pass (paginated + existing).

- [ ] **Step 5: Commit**

```bash
git add app/server/routes/ui.ts app/server/routes/ui.test.ts
git commit -m "feat: add paginated variant to GET /api/books"
```

---

## Task 7: Client — types, context, and provider

**Files:**
- Modify: `app/client/src/provider/book/type.ts`
- Modify: `app/client/src/provider/book/context.ts`
- Modify: `app/client/src/provider/book/provider.tsx`

No tests needed for pure type definitions and state wiring.

- [ ] **Step 1: Add `DisplayUnit` and `PagedBookListResponse` to `type.ts`**

```typescript
// Append to app/client/src/provider/book/type.ts

export type DisplayUnit =
  | { type: 'standalone'; bookId: string }
  | { type: 'series'; seriesName: string };

export type PagedBookListResponse = {
  items: DisplayUnit[];
  books: Book[];
  nextCursor: string | null;
};
```

- [ ] **Step 2: Expand `BookContext` in `context.ts`**

```typescript
import { createContext } from 'react';

import type { BookList, DisplayUnit } from './type';

export type BookContext = {
  bookList: BookList;
  bookListFetched: boolean;
  bookListLoading: boolean;
  bookListError: string | undefined;
  loadingByBookId: Record<string, boolean>;
  errorByBookId: Record<string, string | undefined>;
  completeBookIds: Set<string>;
  bookListItems: DisplayUnit[];
  nextCursor: string | null;
  setBookList: (updater: (prev: BookList) => BookList) => void;
  setBookListFetched: (fetched: boolean) => void;
  setBookListLoading: (loading: boolean) => void;
  setBookListError: (error: string | undefined) => void;
  setLoadingForBook: (bookId: string, loading: boolean) => void;
  setErrorForBook: (bookId: string, error: string | undefined) => void;
  setBookComplete: (bookId: string) => void;
  clearCompleteBookIds: () => void;
  setBookListItems: (updater: (prev: DisplayUnit[]) => DisplayUnit[]) => void;
  setNextCursor: (cursor: string | null) => void;
};

export const Context = createContext<BookContext>({
  bookList: {},
  bookListFetched: false,
  bookListLoading: false,
  bookListError: undefined,
  loadingByBookId: {},
  errorByBookId: {},
  completeBookIds: new Set(),
  bookListItems: [],
  nextCursor: null,
  setBookList: () => {},
  setBookListFetched: () => {},
  setBookListLoading: () => {},
  setBookListError: () => {},
  setLoadingForBook: () => {},
  setErrorForBook: () => {},
  setBookComplete: () => {},
  clearCompleteBookIds: () => {},
  setBookListItems: () => {},
  setNextCursor: () => {},
});
```

- [ ] **Step 3: Add state to `provider.tsx`**

```typescript
import { useCallback, useState, type ReactNode } from 'react';

import { Context } from './context';
import type { BookList, DisplayUnit } from './type';

export type BookProviderProps = { children: ReactNode };
export const BookProvider = ({ children }: BookProviderProps) => {
  const [bookList, setBookListRaw] = useState<BookList>({});
  const [bookListFetched, setBookListFetched] = useState(false);
  const [bookListLoading, setBookListLoading] = useState(false);
  const [bookListError, setBookListError] = useState<string | undefined>();
  const [loadingByBookId, setLoadingByBookIdRaw] = useState<Record<string, boolean>>({});
  const [errorByBookId, setErrorByBookIdRaw] = useState<Record<string, string | undefined>>({});
  const [completeBookIds, setCompleteBookIdsRaw] = useState(new Set<string>());
  const [bookListItems, setBookListItemsRaw] = useState<DisplayUnit[]>([]);
  const [nextCursor, setNextCursorRaw] = useState<string | null>(null);

  const setBookList = useCallback(
    (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
    []
  );
  const setLoadingForBook = useCallback((bookId: string, loading: boolean) => {
    setLoadingByBookIdRaw((prev) => ({ ...prev, [bookId]: loading }));
  }, []);
  const setErrorForBook = useCallback((bookId: string, error: string | undefined) => {
    setErrorByBookIdRaw((prev) => ({ ...prev, [bookId]: error }));
  }, []);
  const setBookComplete = useCallback((bookId: string) => {
    setCompleteBookIdsRaw((prev) => new Set([...prev, bookId]));
  }, []);
  const clearCompleteBookIds = useCallback(() => {
    setCompleteBookIdsRaw(new Set());
  }, []);
  const setBookListItems = useCallback(
    (updater: (prev: DisplayUnit[]) => DisplayUnit[]) => setBookListItemsRaw(updater),
    []
  );
  const setNextCursor = useCallback((cursor: string | null) => setNextCursorRaw(cursor), []);

  return (
    <Context.Provider
      value={{
        bookList,
        bookListFetched,
        bookListLoading,
        bookListError,
        loadingByBookId,
        errorByBookId,
        completeBookIds,
        bookListItems,
        nextCursor,
        setBookList,
        setBookListFetched,
        setBookListLoading,
        setBookListError,
        setLoadingForBook,
        setErrorForBook,
        setBookComplete,
        clearCompleteBookIds,
        setBookListItems,
        setNextCursor,
      }}
    >
      {children}
    </Context.Provider>
  );
};
```

- [ ] **Step 4: Run client tests to catch any breakage from context shape change**

```bash
cd app/client && npm test
```

Expected: tests that construct `Context.Provider` values will fail because they omit the new fields. Fix each affected test file by adding the missing fields to the context value object:

```typescript
// In any test wrapper that spreads or constructs a Context.Provider value, add:
bookListItems: [],
nextCursor: null,
setBookListItems: () => {},
setNextCursor: () => {},
```

Files to update: `use-fetch-book-list.test.tsx`, `use-book-list.test.tsx`, and any other test file that constructs a `Context.Provider` value manually. Search with:

```bash
grep -rl "Context.Provider" app/client/src --include="*.test.tsx"
```

- [ ] **Step 5: Re-run client tests**

```bash
cd app/client && npm test
```

Expected: all 420 client tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/provider/book/type.ts app/client/src/provider/book/context.ts app/client/src/provider/book/provider.tsx
git add app/client/src/provider/book/hook/use-fetch-book-list.test.tsx app/client/src/provider/book/hook/use-book-list.test.tsx
git commit -m "feat: extend BookProvider context with bookListItems and nextCursor"
```

---

## Task 8: `useFetchBookList` — fetch paginated endpoint

**Files:**
- Modify: `app/client/src/provider/book/hook/use-fetch-book-list.ts`
- Modify: `app/client/src/provider/book/hook/use-fetch-book-list.test.tsx`
- Modify: `app/client/src/provider/book/hook/use-book-list.test.tsx`

- [ ] **Step 1: Update `use-fetch-book-list.test.tsx` for new response shape**

Replace the entire test file:

```typescript
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList, DisplayUnit, PagedBookListResponse } from '../type';

import { useFetchBookList } from './use-fetch-book-list';

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Title',
    author: 'Author',
    fileAs: '',
    publisher: '',
    series: '',
    seriesIndex: 0,
    subjects: [],
    identifiers: [],
    hasCover: false,
    size: 0,
    addedAt: '2024-01-01',
    chapterCount: 0,
    pageCount: 0,
    ...overrides,
  };
}

function makeResponse(books: Book[], nextCursor: string | null = null): PagedBookListResponse {
  return {
    items: books.map((b) => ({ type: 'standalone' as const, bookId: b.id })),
    books,
    nextCursor,
  };
}

function makeWrapper({
  initialBooks = {} as BookList,
  bookListLoading = false,
  completeBookIds = new Set<string>(),
  onSetBookList = (_: BookList) => {},
  onSetBookListFetched = vi.fn(),
  onSetBookListError = vi.fn(),
  onSetBookListItems = vi.fn(),
  onSetNextCursor = vi.fn(),
} = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>(initialBooks);
    const [loading, setLoading] = useState(bookListLoading);
    const [bookListItems, setBookListItemsRaw] = useState<DisplayUnit[]>([]);
    const setBookList = useCallback((updater: (prev: BookList) => BookList) => {
      setBookListRaw((prev) => {
        const next = updater(prev);
        onSetBookList(next);
        return next;
      });
    }, []);
    const setBookListItems = useCallback((updater: (prev: DisplayUnit[]) => DisplayUnit[]) => {
      setBookListItemsRaw((prev) => {
        const next = updater(prev);
        onSetBookListItems(next);
        return next;
      });
    }, []);
    return (
      <Context.Provider
        value={{
          bookList,
          bookListFetched: false,
          bookListLoading: loading,
          bookListError: undefined,
          loadingByBookId: {},
          errorByBookId: {},
          completeBookIds,
          bookListItems,
          nextCursor: null,
          setBookList,
          setBookListFetched: onSetBookListFetched,
          setBookListLoading: (v) => setLoading(v),
          setBookListError: onSetBookListError,
          setLoadingForBook: () => {},
          setErrorForBook: () => {},
          setBookComplete: () => {},
          clearCompleteBookIds: () => {},
          setBookListItems,
          setNextCursor: onSetNextCursor,
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

describe('useFetchBookList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches GET /api/books?take=20', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), { wrapper: makeWrapper() });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith('/api/books?take=20', {});
  });

  it('sets bookListFetched to true on success', async () => {
    const onSetBookListFetched = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ onSetBookListFetched }),
    });
    await act(() => result.current());
    expect(onSetBookListFetched).toHaveBeenCalledWith(true);
  });

  it('populates bookListItems with the items array from the response', async () => {
    const book = makeBook({ id: '1', title: 'Dune' });
    const onSetBookListItems = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([book])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ onSetBookListItems }),
    });
    await act(() => result.current());
    expect(onSetBookListItems).toHaveBeenCalledWith([{ type: 'standalone', bookId: '1' }]);
  });

  it('sets nextCursor from the response', async () => {
    const onSetNextCursor = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([], 'abc==')),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ onSetNextCursor }),
    });
    await act(() => result.current());
    expect(onSetNextCursor).toHaveBeenCalledWith('abc==');
  });

  it('merges response books into bookList dict', async () => {
    const books = [makeBook({ id: '1', title: 'Dune' })];
    const onSetBookList = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse(books)),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ onSetBookList }),
    });
    await act(() => result.current());
    expect(onSetBookList).toHaveBeenCalledWith(
      expect.objectContaining({ '1': expect.objectContaining({ title: 'Dune' }) })
    );
  });

  it('preserves complete book data for books already in completeBookIds', async () => {
    const existing = makeBook({ id: '1', title: 'Full Dune', author: 'Herbert' });
    const serverBook = makeBook({ id: '1', title: 'Partial Dune' });
    const onSetBookList = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([serverBook])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({
        initialBooks: { '1': existing },
        completeBookIds: new Set(['1']),
        onSetBookList,
      }),
    });
    await act(() => result.current());
    expect(onSetBookList).toHaveBeenCalledWith({ '1': existing });
  });

  it('sets error message on non-ok response', async () => {
    const onSetBookListError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ onSetBookListError }),
    });
    await act(() => result.current());
    expect(onSetBookListError).toHaveBeenCalledWith('Failed to fetch books');
  });

  it('bails early when bookListLoading is already true', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ bookListLoading: true }),
    });
    await act(() => result.current());
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Update `use-book-list.test.tsx` mock response**

Find every occurrence of:
```typescript
json: () => Promise.resolve([])
```
and replace with:
```typescript
json: () => Promise.resolve({ items: [], books: [], nextCursor: null })
```

Also update the URL assertion (line ~85):
```typescript
await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/books?take=20', {}));
```

- [ ] **Step 3: Run tests to confirm updated tests now fail for the right reason**

```bash
cd app/client && npm test -- use-fetch-book-list
```

Expected: tests fail with type errors or response parsing issues (the hook still calls the old endpoint).

- [ ] **Step 4: Rewrite `use-fetch-book-list.ts`**

```typescript
import { useCallback, useContext } from 'react';

import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget, useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import type { Book, BookList, PagedBookListResponse } from '../type';

export type FetchBookList = () => Promise<void>;

export const useFetchBookList = (): FetchBookList => {
  const {
    bookListLoading,
    bookList,
    completeBookIds,
    setBookList,
    setBookListFetched,
    setBookListLoading,
    setBookListError,
    setBookListItems,
    setNextCursor,
  } = useContext(Context);
  const [isAdmin] = useIsAdmin();
  const [targetUsername] = useLibraryTarget();
  const withTargetUser = useWithTargetUser();

  return useCallback(async () => {
    if (isAdmin && !targetUsername) return;
    if (bookListLoading) return;

    setBookListLoading(true);
    setBookListError(undefined);
    try {
      const response = await apiFetch(withTargetUser('/api/books?take=20'));
      if (!response.ok) throw new Error('Failed to fetch books');
      const { items, books, nextCursor } = await (response.json() as Promise<PagedBookListResponse>);
      setBookList(() =>
        books.reduce(
          (acc, book) => ({
            ...acc,
            [book.id]:
              completeBookIds.has(book.id) && bookList[book.id] !== undefined
                ? bookList[book.id]
                : { ...book, identifiers: book.identifiers ?? [], subjects: book.subjects ?? [] },
          }),
          {} as BookList
        )
      );
      setBookListItems(() => items);
      setNextCursor(nextCursor);
      setBookListFetched(true);
    } catch (err) {
      setBookListError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBookListLoading(false);
    }
  }, [
    isAdmin,
    targetUsername,
    withTargetUser,
    bookListLoading,
    bookList,
    completeBookIds,
    setBookList,
    setBookListFetched,
    setBookListLoading,
    setBookListError,
    setBookListItems,
    setNextCursor,
  ]);
};
```

- [ ] **Step 5: Run client tests**

```bash
cd app/client && npm test
```

Expected: all client tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/provider/book/hook/use-fetch-book-list.ts \
        app/client/src/provider/book/hook/use-fetch-book-list.test.tsx \
        app/client/src/provider/book/hook/use-book-list.test.tsx
git commit -m "feat: useFetchBookList fetches paginated endpoint and populates bookListItems"
```

---

## Task 9: `useFetchNextPage` — new hook

**Files:**
- Create: `app/client/src/provider/book/hook/use-fetch-next-page.ts`
- Create: `app/client/src/provider/book/hook/use-fetch-next-page.test.tsx`
- Modify: `app/client/src/provider/book/hook/index.ts`

- [ ] **Step 1: Write failing tests**

Create `app/client/src/provider/book/hook/use-fetch-next-page.test.tsx`:

```typescript
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { Book, BookList, DisplayUnit, PagedBookListResponse } from '../type';

import { useFetchNextPage } from './use-fetch-next-page';

function makeBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    title: 'Title',
    author: 'Author',
    fileAs: '',
    publisher: '',
    series: '',
    seriesIndex: 0,
    subjects: [],
    identifiers: [],
    hasCover: false,
    size: 0,
    chapterCount: 0,
    pageCount: 0,
    ...overrides,
  };
}

function makeWrapper({
  nextCursor = null as string | null,
  bookListLoading = false,
  initialBooks = {} as BookList,
  initialItems = [] as DisplayUnit[],
  onSetBookList = vi.fn(),
  onSetBookListItems = vi.fn(),
  onSetNextCursor = vi.fn(),
  onSetBookListError = vi.fn(),
} = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>(initialBooks);
    const [items, setItemsRaw] = useState<DisplayUnit[]>(initialItems);
    const [loading, setLoading] = useState(bookListLoading);
    const setBookList = useCallback((updater: (prev: BookList) => BookList) => {
      setBookListRaw((prev) => {
        const next = updater(prev);
        onSetBookList(next);
        return next;
      });
    }, []);
    const setBookListItems = useCallback((updater: (prev: DisplayUnit[]) => DisplayUnit[]) => {
      setItemsRaw((prev) => {
        const next = updater(prev);
        onSetBookListItems(next);
        return next;
      });
    }, []);
    return (
      <Context.Provider
        value={{
          bookList,
          bookListFetched: true,
          bookListLoading: loading,
          bookListError: undefined,
          loadingByBookId: {},
          errorByBookId: {},
          completeBookIds: new Set(),
          bookListItems: items,
          nextCursor,
          setBookList,
          setBookListFetched: () => {},
          setBookListLoading: (v) => setLoading(v),
          setBookListError: onSetBookListError,
          setLoadingForBook: () => {},
          setErrorForBook: () => {},
          setBookComplete: () => {},
          clearCompleteBookIds: () => {},
          setBookListItems,
          setNextCursor: onSetNextCursor,
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

describe('useFetchNextPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does nothing when nextCursor is null', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: null }),
    });
    await act(() => result.current());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does nothing when already loading', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: 'abc==', bookListLoading: true }),
    });
    await act(() => result.current());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches with the cursor URL-encoded', async () => {
    const cursor = Buffer.from('Book B').toString('base64');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<PagedBookListResponse> =>
          Promise.resolve({ items: [], books: [], nextCursor: null }),
      })
    );
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: cursor }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith(
      `/api/books?cursor=${encodeURIComponent(cursor)}&take=20`,
      {}
    );
  });

  it('appends new items to bookListItems', async () => {
    const cursor = Buffer.from('Book A').toString('base64');
    const newBook = makeBook({ id: 'b2', title: 'Book B' });
    const onSetBookListItems = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<PagedBookListResponse> =>
          Promise.resolve({
            items: [{ type: 'standalone', bookId: 'b2' }],
            books: [newBook],
            nextCursor: null,
          }),
      })
    );
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({
        nextCursor: cursor,
        initialItems: [{ type: 'standalone', bookId: 'b1' }],
        onSetBookListItems,
      }),
    });
    await act(() => result.current());
    expect(onSetBookListItems).toHaveBeenCalledWith([
      { type: 'standalone', bookId: 'b1' },
      { type: 'standalone', bookId: 'b2' },
    ]);
  });

  it('updates nextCursor with the value from the response', async () => {
    const cursor = Buffer.from('Book A').toString('base64');
    const nextCursorFromServer = Buffer.from('Book B').toString('base64');
    const onSetNextCursor = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<PagedBookListResponse> =>
          Promise.resolve({ items: [], books: [], nextCursor: nextCursorFromServer }),
      })
    );
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: cursor, onSetNextCursor }),
    });
    await act(() => result.current());
    expect(onSetNextCursor).toHaveBeenCalledWith(nextCursorFromServer);
  });

  it('sets error on non-ok response', async () => {
    const cursor = Buffer.from('X').toString('base64');
    const onSetBookListError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: cursor, onSetBookListError }),
    });
    await act(() => result.current());
    expect(onSetBookListError).toHaveBeenCalledWith('Failed to fetch books');
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd app/client && npm test -- use-fetch-next-page
```

Expected: all tests fail (`useFetchNextPage` does not exist).

- [ ] **Step 3: Implement `use-fetch-next-page.ts`**

```typescript
import { useCallback, useContext } from 'react';

import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget, useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import type { Book, BookList, PagedBookListResponse } from '../type';

export type FetchNextPage = () => Promise<void>;

export const useFetchNextPage = (): FetchNextPage => {
  const {
    bookListLoading,
    nextCursor,
    bookList,
    completeBookIds,
    setBookList,
    setBookListLoading,
    setBookListError,
    setBookListItems,
    setNextCursor,
  } = useContext(Context);
  const [isAdmin] = useIsAdmin();
  const [targetUsername] = useLibraryTarget();
  const withTargetUser = useWithTargetUser();

  return useCallback(async () => {
    if (isAdmin && !targetUsername) return;
    if (bookListLoading) return;
    if (nextCursor === null) return;

    setBookListLoading(true);
    setBookListError(undefined);
    try {
      const url = withTargetUser(
        `/api/books?cursor=${encodeURIComponent(nextCursor)}&take=20`
      );
      const response = await apiFetch(url);
      if (!response.ok) throw new Error('Failed to fetch books');
      const { items, books, nextCursor: newCursor } = await (response.json() as Promise<PagedBookListResponse>);
      setBookList((prev: BookList) =>
        books.reduce(
          (acc, book: Book) => ({
            ...acc,
            [book.id]:
              completeBookIds.has(book.id) && prev[book.id] !== undefined
                ? prev[book.id]
                : { ...book, identifiers: book.identifiers ?? [], subjects: book.subjects ?? [] },
          }),
          prev
        )
      );
      setBookListItems((prev) => [...prev, ...items]);
      setNextCursor(newCursor);
    } catch (err) {
      setBookListError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBookListLoading(false);
    }
  }, [
    isAdmin,
    targetUsername,
    withTargetUser,
    bookListLoading,
    nextCursor,
    bookList,
    completeBookIds,
    setBookList,
    setBookListLoading,
    setBookListError,
    setBookListItems,
    setNextCursor,
  ]);
};
```

- [ ] **Step 4: Export from `hook/index.ts`**

```typescript
export { useFetchNextPage } from './use-fetch-next-page';
```

Add this line to `app/client/src/provider/book/hook/index.ts`.

- [ ] **Step 5: Run client tests**

```bash
cd app/client && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/provider/book/hook/use-fetch-next-page.ts \
        app/client/src/provider/book/hook/use-fetch-next-page.test.tsx \
        app/client/src/provider/book/hook/index.ts
git commit -m "feat: add useFetchNextPage hook for infinite scroll"
```

---

## Task 10: `useBookListItems` + `useBookList` target-change reset

**Files:**
- Create: `app/client/src/provider/book/hook/use-book-list-items.ts`
- Modify: `app/client/src/provider/book/hook/use-book-list.ts`
- Modify: `app/client/src/provider/book/hook/index.ts`
- Modify: `app/client/src/provider/book/index.ts`

- [ ] **Step 1: Create `use-book-list-items.ts`**

```typescript
import { useContext } from 'react';

import { Context } from '../context';
import type { DisplayUnit } from '../type';

export const useBookListItems = (): [DisplayUnit[], string | null] => {
  const { bookListItems, nextCursor } = useContext(Context);
  return [bookListItems, nextCursor];
};
```

- [ ] **Step 2: Update `useBookList` to also reset `bookListItems` and `nextCursor` on target change**

In `use-book-list.ts`, add `setBookListItems` and `setNextCursor` to the destructuring and the target-change effect:

```typescript
import { useContext, useEffect, useMemo, useRef } from 'react';

import { useLibraryTarget } from '~/provider/library-target';

import { Context } from '../context';
import type { Book } from '../type';

import { useFetchBookList } from './use-fetch-book-list';

export type UseBookList =
  | [Book[], false, false, undefined]
  | [Book[], true, false, undefined]
  | [Book[], false, true, undefined]
  | [Book[], false, true, string];

export const useBookList = (): UseBookList => {
  const {
    bookList,
    bookListFetched,
    bookListLoading,
    bookListError,
    setBookListFetched,
    setBookListError,
    clearCompleteBookIds,
    setBookListItems,
    setNextCursor,
  } = useContext(Context);
  const fetchBookList = useFetchBookList();
  const [targetUsername] = useLibraryTarget();

  useEffect(() => {
    if (!bookListLoading && bookListError === undefined && !bookListFetched) {
      void fetchBookList();
    }
  }, [bookListFetched, bookListLoading, bookListError, fetchBookList]);

  const prevTargetRef = useRef(targetUsername);
  useEffect(() => {
    if (prevTargetRef.current === targetUsername) return;
    prevTargetRef.current = targetUsername;
    clearCompleteBookIds();
    setBookListError(undefined);
    setBookListFetched(false);
    setBookListItems(() => []);
    setNextCursor(null);
  }, [
    targetUsername,
    setBookListFetched,
    setBookListError,
    clearCompleteBookIds,
    setBookListItems,
    setNextCursor,
  ]);

  return useMemo(
    () =>
      [
        Object.values(bookList).sort((a, b) => a.title.localeCompare(b.title)),
        bookListLoading,
        bookListError !== undefined,
        bookListError,
      ] as UseBookList,
    [bookList, bookListLoading, bookListError]
  );
};
```

- [ ] **Step 3: Export new hook from `hook/index.ts` and `provider/book/index.ts`**

In `app/client/src/provider/book/hook/index.ts`, add:
```typescript
export { useBookListItems } from './use-book-list-items';
```

In `app/client/src/provider/book/index.ts`, add:
```typescript
useFetchNextPage,
useBookListItems,
```
to the existing export list, and also export `DisplayUnit` from the type exports.

- [ ] **Step 4: Run client tests**

```bash
cd app/client && npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/provider/book/hook/use-book-list-items.ts \
        app/client/src/provider/book/hook/use-book-list.ts \
        app/client/src/provider/book/hook/index.ts \
        app/client/src/provider/book/index.ts
git commit -m "feat: add useBookListItems hook and reset pagination state on target change"
```

---

## Task 11: `LibraryPage` — infinite scroll

**Files:**
- Modify: `app/client/src/page/library/index.tsx`
- Modify: `app/client/src/page/library/style.ts`

- [ ] **Step 1: Add sentinel styles to `style.ts`**

```typescript
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `4rem ${theme.space.xxl}`,
    gap: theme.space.md,
  },
  emptyStateTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.color.text.muted,
  },
  emptyStateSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.faint,
  },
  pageError: {
    textAlign: 'center',
    padding: theme.space.md,
    color: theme.color.text.muted,
    fontSize: theme.fontSize.sm,
  },
  retryButton: {
    marginTop: theme.space.sm,
    cursor: 'pointer',
    color: theme.color.text.link,
    background: 'none',
    border: 'none',
    fontSize: theme.fontSize.sm,
    padding: 0,
  },
}));
```

- [ ] **Step 2: Rewrite `LibraryPage`**

```typescript
import { useEffect, useRef } from 'react';

import { Page, BookRow, SeriesRow } from '~/component';
import { useIsAdmin } from '~/provider/auth';
import { useBookList, useBookListItems, useFetchNextPage } from '~/provider/book';
import { useLibraryTarget } from '~/provider/library-target';

import { useStyle } from './style';

export const LibraryPage = () => {
  const style = useStyle();
  const [isAdmin] = useIsAdmin();
  const [targetUsername] = useLibraryTarget();

  // useBookList triggers the initial fetch and provides loading/error state
  const [, bookListLoading, hasError, bookListError] = useBookList();
  const [bookListItems, nextCursor] = useBookListItems();
  const fetchNextPage = useFetchNextPage();
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          void fetchNextPage();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage]);

  if (isAdmin && !targetUsername) {
    return (
      <Page>
        <div className={style.emptyState}>
          <div className={style.emptyStateTitle}>Select a library</div>
          <div className={style.emptyStateSubtitle}>
            Choose a user from the library selector in the header to view and manage their books
          </div>
        </div>
      </Page>
    );
  }

  if (!bookListLoading && hasError && bookListItems.length === 0) {
    return (
      <Page>
        <div className={style.emptyState}>
          <div className={style.emptyStateTitle}>Failed to load library</div>
          <div className={style.emptyStateSubtitle}>{bookListError}</div>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      {bookListItems.length === 0 ? (
        <div className={style.emptyState}>
          <div className={style.emptyStateTitle}>Your library is empty</div>
          <div className={style.emptyStateSubtitle}>No books have been added yet</div>
        </div>
      ) : (
        <div className={style.root}>
          {bookListItems.map((item) =>
            item.type === 'series' ? (
              <SeriesRow key={item.seriesName} seriesName={item.seriesName} />
            ) : (
              <BookRow key={item.bookId} bookId={item.bookId} />
            )
          )}
          {nextCursor !== null && (
            <div ref={sentinelRef} />
          )}
          {hasError && bookListItems.length > 0 && (
            <div className={style.pageError}>
              Failed to load more books
              <br />
              <button className={style.retryButton} onClick={() => void fetchNextPage()}>
                Retry
              </button>
            </div>
          )}
        </div>
      )}
    </Page>
  );
};
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all 573 server tests and all client tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/page/library/index.tsx app/client/src/page/library/style.ts
git commit -m "feat: infinite scroll library page with IntersectionObserver sentinel"
```

---

## Self-Review Checklist (run before starting implementation)

- **Spec coverage:**
  - ✅ Series table schema and migration — Task 1
  - ✅ addBook Series upsert — Task 2
  - ✅ reimportBook Series sync — Task 3
  - ✅ deleteBook Series cleanup — Task 4
  - ✅ listBooksPage with merge-sort and cursor — Task 5
  - ✅ Paginated GET /api/books variant — Task 6
  - ✅ DisplayUnit, PagedBookListResponse client types — Task 7
  - ✅ BookProvider context additions — Task 7
  - ✅ useFetchBookList → paginated endpoint — Task 8
  - ✅ useFetchNextPage — Task 9
  - ✅ useBookListItems — Task 10
  - ✅ Target-change reset of bookListItems + nextCursor — Task 10
  - ✅ LibraryPage IntersectionObserver sentinel — Task 11
  - ✅ Mid-scroll error + Retry button — Task 11

- **Type consistency:**
  - `DisplayUnit` defined in Task 7 (`type.ts`), used in Task 8, 9, 10, 11 ✅
  - `PagedBookListResponse` defined in Task 7 client (`type.ts`) and Task 5 server (`types.ts`), used consistently ✅
  - `setBookListItems` / `setNextCursor` defined in Task 7 (`context.ts`, `provider.tsx`), consumed in Tasks 8, 9, 10 ✅
  - `useBookListItems` returns `[DisplayUnit[], string | null]` in Task 10, destructured as `[bookListItems, nextCursor]` in Task 11 ✅
  - `useFetchNextPage` exported from `hook/index.ts` in Task 9, from `provider/book/index.ts` in Task 10 ✅

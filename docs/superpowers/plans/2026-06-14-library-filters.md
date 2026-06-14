# Library Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side type (standalone/series) and status (not-started/in-progress/completed) filters to the Library page, working correctly with cursor-based pagination.

**Architecture:** Filter params (`type`, `status`) are passed as query params to `GET /api/books`. The server applies them in `listBooksPage` — type by skipping the irrelevant query, status by pre-fetching progress and filtering book/series IDs. On the client, `BookListFilter` lives in the book provider context; changing it resets the list and re-fetches from page 1. A new `FilterBar` component with two `<select>` dropdowns lives at the top of the book list.

**Tech Stack:** TypeScript, Prisma (SQLite), Express, React, JSS (`createUseStyles`)

---

## File Map

**Server — create/modify:**
- Modify: `app/server/types.ts` — add `BookListFilters`
- Modify: `app/server/services/book-store.ts` — `listBooksPage` gains optional `filters` param
- Modify: `app/server/routes/ui.ts` — parse & validate `type`/`status` query params

**Server — tests:**
- Modify: `app/server/services/book-store.test.ts` — new `listBooksPage with filters` describe block
- Modify: `app/server/routes/ui.test.ts` — new `GET /api/books (filtered)` describe block

**Client — modify:**
- Modify: `app/client/src/provider/book/type.ts` — add `BookListFilter`
- Modify: `app/client/src/provider/book/context.ts` — add `bookListFilter`/`setBookListFilter`
- Modify: `app/client/src/provider/book/provider.tsx` — wire up filter state with reset logic
- Modify: `app/client/src/provider/book/hook/use-fetch-book-list.ts` — append filter params to URL
- Modify: `app/client/src/provider/book/hook/use-fetch-next-page.ts` — append filter params to URL
- Modify: `app/client/src/provider/book/hook/index.ts` — export `useBookListFilter`
- Modify: `app/client/src/provider/book/index.ts` — export `useBookListFilter` and `BookListFilter`
- Modify: `app/client/src/component/index.ts` — export `FilterBar`
- Modify: `app/client/src/page/library/index.tsx` — render `FilterBar`

**Client — create:**
- Create: `app/client/src/provider/book/hook/use-book-list-filter.ts`
- Create: `app/client/src/component/filter-bar/index.tsx`
- Create: `app/client/src/component/filter-bar/style.ts`

**Client — tests:**
- Modify: `app/client/src/provider/book/hook/use-fetch-book-list.test.tsx`
- Modify: `app/client/src/provider/book/hook/use-fetch-next-page.test.tsx`
- Modify: `app/client/src/provider/book/hook/use-book-list.test.tsx`

---

## Task 1: Add `BookListFilters` to server types

**Files:**
- Modify: `app/server/types.ts`

- [ ] **Step 1: Add the type**

  Open `app/server/types.ts` and add after the existing `PagedBookListResponse` type (around line 80):

  ```ts
  export type BookListFilters = {
    type?: 'standalone' | 'series';
    status?: 'not-started' | 'in-progress' | 'completed';
  };
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add app/server/types.ts
  git commit -m "feat: add BookListFilters type"
  ```

---

## Task 2: Write failing book-store filter tests

**Files:**
- Modify: `app/server/services/book-store.test.ts`

- [ ] **Step 1: Add `insertProgress` helper and new describe block**

  At the top of `app/server/services/book-store.test.ts`, after the existing imports, there is already an `OWNER` constant and helpers. Add the `insertProgress` helper immediately before the first `describe` block, and append the new `describe` block at the end of the file:

  ```ts
  // Add after the existing helpers (e.g. after `insertHistory`):
  async function insertProgress(bookId: string, percentage: number): Promise<void> {
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: bookId,
        progress: `epub:/${bookId}/${percentage}`,
        percentage,
        device: 'Kobo',
        deviceId: 'dev1',
        timestamp: Date.now(),
      },
    });
  }
  ```

  Then append at the very end of the file:

  ```ts
  describe('listBooksPage with filters', () => {
    it('type=standalone excludes series rows', async () => {
      await bookStore.addBook(OWNER, 'sa1', stage('sa1'), { ...FAKE_META, title: 'Alpha', series: '', seriesIndex: 0 });
      await bookStore.addBook(OWNER, 'sr1', stage('sr1'), { ...FAKE_META, title: 'Beta 1', series: 'Beta', seriesIndex: 1 });
      const result = await bookStore.listBooksPage(OWNER, null, 20, { type: 'standalone' });
      expect(result.items).toEqual([{ type: 'standalone', bookId: 'sa1' }]);
    });

    it('type=series excludes standalone rows', async () => {
      await bookStore.addBook(OWNER, 'sa1', stage('sa1'), { ...FAKE_META, title: 'Alpha', series: '', seriesIndex: 0 });
      await bookStore.addBook(OWNER, 'sr1', stage('sr1'), { ...FAKE_META, title: 'Beta 1', series: 'Beta', seriesIndex: 1 });
      const result = await bookStore.listBooksPage(OWNER, null, 20, { type: 'series' });
      expect(result.items).toEqual([{ type: 'series', seriesName: 'Beta' }]);
    });

    it('status=not-started returns standalone books with no progress', async () => {
      await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Alpha', series: '', seriesIndex: 0 });
      await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'Beta', series: '', seriesIndex: 0 });
      await insertProgress('b1', 0.5);
      const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'not-started' });
      expect(result.items).toEqual([{ type: 'standalone', bookId: 'b2' }]);
    });

    it('status=in-progress returns standalone books with partial progress', async () => {
      await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Alpha', series: '', seriesIndex: 0 });
      await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'Beta', series: '', seriesIndex: 0 });
      await bookStore.addBook(OWNER, 'b3', stage('b3'), { ...FAKE_META, title: 'Gamma', series: '', seriesIndex: 0 });
      await insertProgress('b1', 0.5);
      await insertProgress('b2', 1.0);
      const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'in-progress' });
      expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
    });

    it('status=completed returns standalone books with percentage >= 1', async () => {
      await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Alpha', series: '', seriesIndex: 0 });
      await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'Beta', series: '', seriesIndex: 0 });
      await insertProgress('b1', 1.0);
      const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'completed' });
      expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
    });

    it('status=not-started returns series where no member book has progress', async () => {
      await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), { ...FAKE_META, title: 'Dune 1', series: 'Dune', seriesIndex: 1 });
      await bookStore.addBook(OWNER, 's2b1', stage('s2b1'), { ...FAKE_META, title: 'Foundation 1', series: 'Foundation', seriesIndex: 1 });
      await insertProgress('s1b1', 0.5);
      const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'not-started' });
      expect(result.items).toEqual([{ type: 'series', seriesName: 'Foundation' }]);
    });

    it('status=completed returns series where all member books have percentage >= 1', async () => {
      await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), { ...FAKE_META, title: 'Dune 1', series: 'Dune', seriesIndex: 1 });
      await bookStore.addBook(OWNER, 's1b2', stage('s1b2'), { ...FAKE_META, title: 'Dune 2', series: 'Dune', seriesIndex: 2 });
      await bookStore.addBook(OWNER, 's2b1', stage('s2b1'), { ...FAKE_META, title: 'Foundation 1', series: 'Foundation', seriesIndex: 1 });
      await insertProgress('s1b1', 1.0);
      await insertProgress('s1b2', 1.0);
      await insertProgress('s2b1', 0.5);
      const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'completed' });
      expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    });

    it('status=in-progress returns series with 2 completed + 1 unread', async () => {
      await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), { ...FAKE_META, title: 'Dune 1', series: 'Dune', seriesIndex: 1 });
      await bookStore.addBook(OWNER, 's1b2', stage('s1b2'), { ...FAKE_META, title: 'Dune 2', series: 'Dune', seriesIndex: 2 });
      await bookStore.addBook(OWNER, 's1b3', stage('s1b3'), { ...FAKE_META, title: 'Dune 3', series: 'Dune', seriesIndex: 3 });
      await insertProgress('s1b1', 1.0);
      await insertProgress('s1b2', 1.0);
      // s1b3 has no progress
      const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'in-progress' });
      expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    });

    it('type + status combined: series + completed', async () => {
      await bookStore.addBook(OWNER, 'sa1', stage('sa1'), { ...FAKE_META, title: 'Alpha', series: '', seriesIndex: 0 });
      await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), { ...FAKE_META, title: 'Dune 1', series: 'Dune', seriesIndex: 1 });
      await insertProgress('sa1', 1.0);
      await insertProgress('s1b1', 1.0);
      const result = await bookStore.listBooksPage(OWNER, null, 20, { type: 'series', status: 'completed' });
      expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    });

    it('no filters returns same result as calling without filters arg', async () => {
      await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Alpha', series: '', seriesIndex: 0 });
      const withoutFilters = await bookStore.listBooksPage(OWNER, null, 20);
      const withEmptyFilters = await bookStore.listBooksPage(OWNER, null, 20, {});
      expect(withEmptyFilters.items).toEqual(withoutFilters.items);
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  cd app && npx jest services/book-store.test.ts --testNamePattern="listBooksPage with filters" 2>&1 | tail -20
  ```

  Expected: FAIL — `listBooksPage` does not accept a 4th argument yet.

---

## Task 3: Implement book-store filter logic

**Files:**
- Modify: `app/server/services/book-store.ts`

- [ ] **Step 1: Add import and helper functions**

  At the top of `app/server/services/book-store.ts`, add `BookListFilters` to the import from `../types`:

  ```ts
  import { Book, BookSummary, EpubMeta, Owner, PageCursor, PagedBookListResponse, BookListFilters } from '../types';
  ```

  Then add these two pure helper functions immediately before the `BookStore` class definition:

  ```ts
  function computeSeriesStatus(
    bookIds: string[],
    progressMap: Map<string, number>
  ): 'not-started' | 'in-progress' | 'completed' {
    if (bookIds.length === 0) return 'not-started';
    const progressValues = bookIds.map((id) => progressMap.get(id) ?? 0);
    const anyStarted = progressValues.some((p) => p > 0);
    if (!anyStarted) return 'not-started';
    const allCompleted = progressValues.every((p) => p >= 1);
    if (allCompleted) return 'completed';
    return 'in-progress';
  }

  function standaloneStatusWhere(
    status: 'not-started' | 'in-progress' | 'completed',
    progressMap: Map<string, number>
  ): Prisma.BookWhereInput {
    const allStartedIds = [...progressMap.keys()];
    const inProgressIds = [...progressMap.entries()]
      .filter(([, pct]) => pct > 0 && pct < 1)
      .map(([id]) => id);
    const completedIds = [...progressMap.entries()]
      .filter(([, pct]) => pct >= 1)
      .map(([id]) => id);

    switch (status) {
      case 'not-started':
        return allStartedIds.length > 0 ? { id: { notIn: allStartedIds } } : {};
      case 'in-progress':
        return { id: { in: inProgressIds } };
      case 'completed':
        return { id: { in: completedIds } };
    }
  }
  ```

- [ ] **Step 2: Modify `listBooksPage` signature and add filter logic**

  Replace the existing `listBooksPage` signature (line 676):

  ```ts
  // Before:
  async listBooksPage(
    owner: Owner,
    cursor: PageCursor | null,
    take: number
  ): Promise<PagedBookListResponse> {

  // After:
  async listBooksPage(
    owner: Owner,
    cursor: PageCursor | null,
    take: number,
    filters?: BookListFilters
  ): Promise<PagedBookListResponse> {
  ```

  Then, immediately after `const fetchLimit = take + 1;` (line 682), insert the filter setup block:

  ```ts
  // Pre-fetch progress when status filter is active
  let progressMap: Map<string, number> | null = null;
  if (filters?.status) {
    const progresses = await this.prisma.progress.findMany({
      where: { userId: owner.userId },
      select: { document: true, percentage: true },
    });
    progressMap = new Map(progresses.map((p) => [p.document, p.percentage]));
  }

  const includeStandalones = !filters?.type || filters.type === 'standalone';
  const includeSeries = !filters?.type || filters.type === 'series';
  ```

- [ ] **Step 3: Extend WHERE clauses and skip queries when type-filtered**

  Find the block that builds `seriesWhere` and `bookWhere` (starting around line 690). After the `bookWhere` is fully built (end of the `if (!cursor) ... else { ... }` block), insert:

  ```ts
  // Apply status filter to standalone WHERE
  if (filters?.status && progressMap) {
    const statusFilter = standaloneStatusWhere(filters.status, progressMap);
    bookWhere = { ...bookWhere, ...statusFilter };
  }

  // For series status filter, pre-compute matching series IDs
  let matchingSeriesIds: string[] | null = null;
  if (includeSeries && filters?.status && progressMap) {
    const pm = progressMap;
    const allSeriesWithBooks = await this.prisma.series.findMany({
      where: { userId: owner.userId },
      select: { id: true, books: { select: { id: true } } },
    });
    matchingSeriesIds = allSeriesWithBooks
      .filter((s) => computeSeriesStatus(s.books.map((b) => b.id), pm) === filters.status)
      .map((s) => s.id);
  }

  const finalSeriesWhere: Prisma.SeriesWhereInput =
    matchingSeriesIds !== null
      ? { ...seriesWhere, id: { in: matchingSeriesIds } }
      : seriesWhere;
  ```

- [ ] **Step 4: Replace the parallel query block to respect type filter**

  `Prisma` is already imported at the top of the file (`import { PrismaClient, Prisma } from '@prisma/client'`).

  Find the `const [seriesRows, standaloneRows] = await Promise.all([` block (around line 712). Replace it entirely with:

  ```ts
  const [seriesRows, standaloneRows] = await Promise.all([
    includeSeries
      ? this.prisma.series.findMany({
          where: finalSeriesWhere,
          orderBy: { sortKey: 'asc' },
          take: fetchLimit,
        })
      : Promise.resolve([] as Awaited<ReturnType<typeof this.prisma.series.findMany>>),
    includeStandalones
      ? this.prisma.book.findMany({
          where: bookWhere,
          orderBy: [{ title: 'asc' }, { id: 'asc' }],
          take: fetchLimit,
          select: BOOK_SELECT,
        })
      : Promise.resolve([] as Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>[]),
  ]);
  ```

- [ ] **Step 5: Run failing tests to verify they now pass**

  ```bash
  cd app && npx jest services/book-store.test.ts --testNamePattern="listBooksPage with filters" 2>&1 | tail -20
  ```

  Expected: all new filter tests PASS.

- [ ] **Step 6: Run full server test suite**

  ```bash
  cd app && npx jest 2>&1 | tail -10
  ```

  Expected: all tests pass (no regressions).

- [ ] **Step 7: Commit**

  ```bash
  git add app/server/types.ts app/server/services/book-store.ts app/server/services/book-store.test.ts
  git commit -m "feat: add filter support to listBooksPage (type and status)"
  ```

---

## Task 4: Write failing route filter tests

**Files:**
- Modify: `app/server/routes/ui.test.ts`

- [ ] **Step 1: Add progress helper and new describe block**

  In `app/server/routes/ui.test.ts`, add a progress helper inside `beforeEach` isn't possible since `prisma` is set up there. Instead, add a standalone helper function after the existing `stage` helper (around line 87):

  ```ts
  async function seedProgress(
    userId: string,
    bookId: string,
    percentage: number
  ): Promise<void> {
    await prisma.progress.create({
      data: {
        userId,
        document: bookId,
        progress: `epub:/${bookId}/${percentage}`,
        percentage,
        device: 'Kobo',
        deviceId: 'dev1',
        timestamp: 1,
      },
    });
  }
  ```

  Then append this new describe block at the end of the file (after the last closing `}`):

  ```ts
  describe('GET /api/books (filtered)', () => {
    it('type=standalone excludes series', async () => {
      await bookStore.addBook(aliceOwner, 'sa1', stage('sa1'), { ...FAKE_META, title: 'Alpha', series: '', seriesIndex: 0 });
      await bookStore.addBook(aliceOwner, 'sr1', stage('sr1'), { ...FAKE_META, title: 'Beta 1', series: 'Beta', seriesIndex: 1 });
      const token = await loginAlice();
      const res = await request(app).get('/api/books?take=20&type=standalone').set(...bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ type: 'standalone', bookId: 'sa1' }]);
    });

    it('type=series excludes standalones', async () => {
      await bookStore.addBook(aliceOwner, 'sa1', stage('sa1'), { ...FAKE_META, title: 'Alpha', series: '', seriesIndex: 0 });
      await bookStore.addBook(aliceOwner, 'sr1', stage('sr1'), { ...FAKE_META, title: 'Beta 1', series: 'Beta', seriesIndex: 1 });
      const token = await loginAlice();
      const res = await request(app).get('/api/books?take=20&type=series').set(...bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ type: 'series', seriesName: 'Beta' }]);
    });

    it('status=not-started returns books with no progress', async () => {
      await bookStore.addBook(aliceOwner, 'b1', stage('b1'), { ...FAKE_META, title: 'Alpha', series: '', seriesIndex: 0 });
      await bookStore.addBook(aliceOwner, 'b2', stage('b2'), { ...FAKE_META, title: 'Beta', series: '', seriesIndex: 0 });
      await seedProgress(aliceId, 'b1', 0.5);
      const token = await loginAlice();
      const res = await request(app).get('/api/books?take=20&status=not-started').set(...bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ type: 'standalone', bookId: 'b2' }]);
    });

    it('combined type=series&status=completed', async () => {
      await bookStore.addBook(aliceOwner, 'sa1', stage('sa1'), { ...FAKE_META, title: 'Alpha', series: '', seriesIndex: 0 });
      await bookStore.addBook(aliceOwner, 'sr1', stage('sr1'), { ...FAKE_META, title: 'Beta 1', series: 'Beta', seriesIndex: 1 });
      await seedProgress(aliceId, 'sa1', 1.0);
      await seedProgress(aliceId, 'sr1', 1.0);
      const token = await loginAlice();
      const res = await request(app).get('/api/books?take=20&type=series&status=completed').set(...bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ type: 'series', seriesName: 'Beta' }]);
    });

    it('returns 400 for invalid type value', async () => {
      const token = await loginAlice();
      const res = await request(app).get('/api/books?take=20&type=invalid').set(...bearer(token));
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid status value', async () => {
      const token = await loginAlice();
      const res = await request(app).get('/api/books?take=20&status=unknown').set(...bearer(token));
      expect(res.status).toBe(400);
    });

    it('filter works without take param (activates paginated path with default take)', async () => {
      await bookStore.addBook(aliceOwner, 'sa1', stage('sa1'), { ...FAKE_META, title: 'Alpha', series: '', seriesIndex: 0 });
      await bookStore.addBook(aliceOwner, 'sr1', stage('sr1'), { ...FAKE_META, title: 'Beta 1', series: 'Beta', seriesIndex: 1 });
      const token = await loginAlice();
      const res = await request(app).get('/api/books?type=standalone').set(...bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ type: 'standalone', bookId: 'sa1' }]);
      expect(res.body).toHaveProperty('nextCursor');
    });
  });
  ```

- [ ] **Step 2: Run to verify they fail**

  ```bash
  cd app && npx jest routes/ui.test.ts --testNamePattern="GET /api/books .filtered." 2>&1 | tail -20
  ```

  Expected: FAIL — route does not parse `type`/`status` yet.

---

## Task 5: Implement route filter parsing

**Files:**
- Modify: `app/server/routes/ui.ts`

- [ ] **Step 1: Add `BookListFilters` to the import**

  In `app/server/routes/ui.ts`, the import from `../types` currently reads:

  ```ts
  import { AppConfig, EpubMeta, Owner, PageCursor } from '../types';
  ```

  Add `BookListFilters`:

  ```ts
  import { AppConfig, BookListFilters, EpubMeta, Owner, PageCursor } from '../types';
  ```

- [ ] **Step 2: Replace the `GET /api/books` handler body**

  Find the handler starting at `router.get('/api/books', requireAuth, async (req: Request, res: Response) => {` (around line 398). Replace the entire handler body with:

  ```ts
  router.get('/api/books', requireAuth, async (req: Request, res: Response) => {
    const owner = await resolveOwner(req, res);
    if (!owner) return;

    const { cursor, take, type, status } = req.query;

    const VALID_TYPES = new Set(['standalone', 'series']);
    const VALID_STATUSES = new Set(['not-started', 'in-progress', 'completed']);

    if (type !== undefined && (typeof type !== 'string' || !VALID_TYPES.has(type))) {
      res.status(400).json({ error: 'Invalid type. Must be "standalone" or "series".' });
      return;
    }
    if (status !== undefined && (typeof status !== 'string' || !VALID_STATUSES.has(status))) {
      res.status(400).json({ error: 'Invalid status. Must be "not-started", "in-progress", or "completed".' });
      return;
    }

    const filters: BookListFilters | undefined =
      type !== undefined || status !== undefined
        ? {
            type: type as BookListFilters['type'],
            status: status as BookListFilters['status'],
          }
        : undefined;

    if (cursor !== undefined || take !== undefined || filters !== undefined) {
      let pageCursor: PageCursor | null = null;
      if (typeof cursor === 'string' && cursor) {
        try {
          pageCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) as PageCursor;
        } catch {
          pageCursor = null;
        }
      }
      const pageSize =
        typeof take === 'string' ? Math.min(Math.max(parseInt(take, 10) || 20, 1), 100) : 20;
      const result = await bookStore.listBooksPage(owner, pageCursor, pageSize, filters);
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

- [ ] **Step 3: Run failing route tests to verify they now pass**

  ```bash
  cd app && npx jest routes/ui.test.ts --testNamePattern="GET /api/books .filtered." 2>&1 | tail -20
  ```

  Expected: all filter route tests PASS.

- [ ] **Step 4: Run full server test suite**

  ```bash
  cd app && npx jest 2>&1 | tail -10
  ```

  Expected: all tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add app/server/routes/ui.ts app/server/routes/ui.test.ts
  git commit -m "feat: parse and validate type/status filter params in GET /api/books"
  ```

---

## Task 6: Add `BookListFilter` to client types and context

**Files:**
- Modify: `app/client/src/provider/book/type.ts`
- Modify: `app/client/src/provider/book/context.ts`

- [ ] **Step 1: Add `BookListFilter` to type.ts**

  In `app/client/src/provider/book/type.ts`, add after the existing `DisplayUnit` type:

  ```ts
  export type BookListFilter = {
    type?: 'standalone' | 'series';
    status?: 'not-started' | 'in-progress' | 'completed';
  };
  ```

- [ ] **Step 2: Add filter fields to context.ts**

  In `app/client/src/provider/book/context.ts`, update the import to include `BookListFilter`:

  ```ts
  import type { BookList, BookListFilter, DisplayUnit } from './type';
  ```

  Then add to the `BookContext` type:

  ```ts
  export type BookContext = {
    // ... existing fields ...
    bookListFilter: BookListFilter;
    setBookListFilter: (filter: BookListFilter) => void;
  };
  ```

  And add defaults to `createContext(...)`:

  ```ts
  export const Context = createContext<BookContext>({
    // ... existing defaults ...
    bookListFilter: {},
    setBookListFilter: () => {},
  });
  ```

- [ ] **Step 3: Run client tests to verify no regressions**

  ```bash
  cd app/client && npx vitest run 2>&1 | tail -10
  ```

  Expected: all 428 tests pass. (Tests that construct `Context.Provider` values will fail TypeScript compilation but not vitest runtime — check for TS errors in the next step.)

- [ ] **Step 4: Commit**

  ```bash
  git add app/client/src/provider/book/type.ts app/client/src/provider/book/context.ts
  git commit -m "feat: add BookListFilter type and filter fields to book context"
  ```

---

## Task 7: Wire filter state in the book provider

**Files:**
- Modify: `app/client/src/provider/book/provider.tsx`

- [ ] **Step 1: Add filter state and `setBookListFilter` to provider**

  In `app/client/src/provider/book/provider.tsx`, update the import:

  ```ts
  import type { BookList, BookListFilter, DisplayUnit } from './type';
  ```

  Add state variable after the existing `useState` calls:

  ```ts
  const [bookListFilter, setBookListFilterRaw] = useState<BookListFilter>({});
  ```

  Add the `setBookListFilter` callback after the existing `useCallback` definitions:

  ```ts
  const setBookListFilter = useCallback((filter: BookListFilter) => {
    setBookListFilterRaw(filter);
    setBookListFetched(false);
    setBookListError(undefined);
    setBookListRaw({});
    setBookListItemsRaw(() => []);
    setNextCursorRaw(null);
    setCompleteBookIdsRaw(new Set());
  }, []);
  ```

  Add the new values to the `Context.Provider` `value` prop:

  ```tsx
  <Context.Provider
    value={{
      // ... existing values ...
      bookListFilter,
      setBookListFilter,
    }}
  >
  ```

- [ ] **Step 2: Fix any TypeScript errors in test wrappers**

  The test files for `use-fetch-book-list.test.tsx`, `use-fetch-next-page.test.tsx`, and `use-book-list.test.tsx` all construct `Context.Provider` values manually. Each `makeWrapper` function will now be missing `bookListFilter` and `setBookListFilter`. Add them to each wrapper's context value:

  In `use-fetch-book-list.test.tsx` — inside the `makeWrapper` return's `<Context.Provider value={{...}}>`:
  ```tsx
  bookListFilter: {},
  setBookListFilter: () => {},
  ```

  In `use-fetch-next-page.test.tsx` — same addition.

  In `use-book-list.test.tsx` — same addition.

- [ ] **Step 3: Run client tests**

  ```bash
  cd app/client && npx vitest run 2>&1 | tail -10
  ```

  Expected: all tests pass.

- [ ] **Step 4: Commit**

  ```bash
  git add app/client/src/provider/book/provider.tsx app/client/src/provider/book/hook/use-fetch-book-list.test.tsx app/client/src/provider/book/hook/use-fetch-next-page.test.tsx app/client/src/provider/book/hook/use-book-list.test.tsx
  git commit -m "feat: add filter state and reset logic to BookProvider"
  ```

---

## Task 8: Create `useBookListFilter` hook and update exports

**Files:**
- Create: `app/client/src/provider/book/hook/use-book-list-filter.ts`
- Modify: `app/client/src/provider/book/hook/index.ts`
- Modify: `app/client/src/provider/book/index.ts`

- [ ] **Step 1: Create the hook**

  Create `app/client/src/provider/book/hook/use-book-list-filter.ts`:

  ```ts
  import { useContext } from 'react';

  import { Context } from '../context';
  import type { BookListFilter } from '../type';

  export const useBookListFilter = (): [BookListFilter, (filter: BookListFilter) => void] => {
    const { bookListFilter, setBookListFilter } = useContext(Context);
    return [bookListFilter, setBookListFilter];
  };
  ```

- [ ] **Step 2: Export from hook index**

  In `app/client/src/provider/book/hook/index.ts`, add:

  ```ts
  export { useBookListFilter } from './use-book-list-filter';
  ```

- [ ] **Step 3: Export from provider index**

  In `app/client/src/provider/book/index.ts`, update the hook export line:

  ```ts
  export {
    useBook,
    useBookLineage,
    useBookList,
    useBookListFilter,
    useBookListItems,
    useDeleteBook,
    useFetchBook,
    useFetchBookList,
    useFetchNextPage,
    usePatchBookMetadata,
    useRegenChapters,
    useScanLibrary,
    useSeriesBookList,
    useSeriesList,
    useStandaloneBookList,
    useUnlinkBookLineage,
    useUploadBookList,
    useUploadQueue,
  } from './hook';
  ```

  Also add `BookListFilter` to the type exports:

  ```ts
  export type { BookList, Book, BookListFilter, DisplayUnit, Identifier, Series, UploadResult } from './type';
  ```

- [ ] **Step 4: Run client tests**

  ```bash
  cd app/client && npx vitest run 2>&1 | tail -10
  ```

  Expected: all tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add app/client/src/provider/book/hook/use-book-list-filter.ts app/client/src/provider/book/hook/index.ts app/client/src/provider/book/index.ts
  git commit -m "feat: add useBookListFilter hook"
  ```

---

## Task 9: Update `useFetchBookList` to append filter params

**Files:**
- Modify: `app/client/src/provider/book/hook/use-fetch-book-list.test.tsx`
- Modify: `app/client/src/provider/book/hook/use-fetch-book-list.ts`

- [ ] **Step 1: Add filter tests to `use-fetch-book-list.test.tsx`**

  In `use-fetch-book-list.test.tsx`, update the `makeWrapper` function signature to accept `bookListFilter`:

  ```ts
  // Add to the destructured params:
  bookListFilter = {} as BookListFilter,
  ```

  Add the import at the top:
  ```ts
  import type { Book, BookList, BookListFilter, DisplayUnit, PagedBookListResponse } from '../type';
  ```

  Add `bookListFilter` and `setBookListFilter` to the `Context.Provider` value inside `makeWrapper`:
  ```tsx
  bookListFilter,
  setBookListFilter: () => {},
  ```

  Then add these two tests inside the `describe('useFetchBookList', ...)` block:

  ```ts
  it('appends type filter param to URL when bookListFilter.type is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ bookListFilter: { type: 'series' } }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith('/api/books?type=series&take=20', {});
  });

  it('appends status filter param to URL when bookListFilter.status is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ bookListFilter: { status: 'in-progress' } }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith('/api/books?status=in-progress&take=20', {});
  });

  it('omits filter params when bookListFilter is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeResponse([])),
      })
    );
    const { result } = renderHook(() => useFetchBookList(), {
      wrapper: makeWrapper({ bookListFilter: {} }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith('/api/books?take=20', {});
  });
  ```

- [ ] **Step 2: Run new tests to verify they fail**

  ```bash
  cd app/client && npx vitest run provider/book/hook/use-fetch-book-list.test.tsx 2>&1 | tail -20
  ```

  Expected: the 3 new filter tests FAIL (URL does not include filter params yet).

- [ ] **Step 3: Update `use-fetch-book-list.ts` to append filter params**

  In `app/client/src/provider/book/hook/use-fetch-book-list.ts`, add `bookListFilter` to the context destructure:

  ```ts
  const {
    bookListLoading,
    bookList,
    bookListFilter,
    completeBookIds,
    setBookList,
    setBookListFetched,
    setBookListLoading,
    setBookListError,
    setBookListItems,
    setNextCursor,
  } = useContext(Context);
  ```

  Replace the hardcoded URL inside the `useCallback`:

  ```ts
  // Before:
  const response = await apiFetch(withTargetUser('/api/books?take=20'));

  // After:
  const params = new URLSearchParams();
  if (bookListFilter.type) params.append('type', bookListFilter.type);
  if (bookListFilter.status) params.append('status', bookListFilter.status);
  params.append('take', '20');
  const response = await apiFetch(withTargetUser(`/api/books?${params.toString()}`));
  ```

  Add `bookListFilter` to the `useCallback` dependency array:

  ```ts
  }, [
    isAdmin,
    targetUsername,
    withTargetUser,
    bookListLoading,
    bookList,
    bookListFilter,
    completeBookIds,
    // ... rest of existing deps
  ]);
  ```

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  cd app/client && npx vitest run provider/book/hook/use-fetch-book-list.test.tsx 2>&1 | tail -10
  ```

  Expected: all tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add app/client/src/provider/book/hook/use-fetch-book-list.ts app/client/src/provider/book/hook/use-fetch-book-list.test.tsx
  git commit -m "feat: append filter params to useFetchBookList URL"
  ```

---

## Task 10: Update `useFetchNextPage` to append filter params

**Files:**
- Modify: `app/client/src/provider/book/hook/use-fetch-next-page.test.tsx`
- Modify: `app/client/src/provider/book/hook/use-fetch-next-page.ts`

- [ ] **Step 1: Add filter to `makeWrapper` and add new tests**

  In `use-fetch-next-page.test.tsx`, add `bookListFilter` to the `makeWrapper` params and the `Context.Provider` value (same pattern as Task 9 Step 1):

  ```ts
  // In makeWrapper params:
  bookListFilter = {} as BookListFilter,

  // In Context.Provider value:
  bookListFilter,
  setBookListFilter: () => {},
  ```

  Add this import at the top:
  ```ts
  import type { Book, BookList, BookListFilter, DisplayUnit, PagedBookListResponse } from '../type';
  ```

  Add these tests inside `describe('useFetchNextPage', ...)`:

  ```ts
  it('appends type filter param to next-page URL', async () => {
    const cursor = btoa('Book A');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<PagedBookListResponse> =>
          Promise.resolve({ items: [], books: [], nextCursor: null }),
      })
    );
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: cursor, bookListFilter: { type: 'series' } }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith(
      `/api/books?cursor=${encodeURIComponent(cursor)}&type=series&take=20`,
      {}
    );
  });

  it('appends status filter param to next-page URL', async () => {
    const cursor = btoa('Book A');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: (): Promise<PagedBookListResponse> =>
          Promise.resolve({ items: [], books: [], nextCursor: null }),
      })
    );
    const { result } = renderHook(() => useFetchNextPage(), {
      wrapper: makeWrapper({ nextCursor: cursor, bookListFilter: { status: 'completed' } }),
    });
    await act(() => result.current());
    expect(fetch).toHaveBeenCalledWith(
      `/api/books?cursor=${encodeURIComponent(cursor)}&status=completed&take=20`,
      {}
    );
  });
  ```

- [ ] **Step 2: Run new tests to verify they fail**

  ```bash
  cd app/client && npx vitest run provider/book/hook/use-fetch-next-page.test.tsx 2>&1 | tail -20
  ```

  Expected: the 2 new filter tests FAIL.

- [ ] **Step 3: Update `use-fetch-next-page.ts` to append filter params**

  In `app/client/src/provider/book/hook/use-fetch-next-page.ts`, add `bookListFilter` to the context destructure:

  ```ts
  const {
    bookListLoading,
    nextCursor,
    bookList,
    bookListFilter,
    completeBookIds,
    setBookList,
    setBookListLoading,
    setBookListError,
    setBookListItems,
    setNextCursor,
  } = useContext(Context);
  ```

  Replace the hardcoded URL inside the `useCallback`:

  ```ts
  // Before:
  const url = withTargetUser(`/api/books?cursor=${encodeURIComponent(nextCursor)}&take=20`);

  // After:
  const params = new URLSearchParams();
  params.append('cursor', nextCursor);
  if (bookListFilter.type) params.append('type', bookListFilter.type);
  if (bookListFilter.status) params.append('status', bookListFilter.status);
  params.append('take', '20');
  const url = withTargetUser(`/api/books?${params.toString()}`);
  ```

  Add `bookListFilter` to the `useCallback` dependency array.

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  cd app/client && npx vitest run provider/book/hook/use-fetch-next-page.test.tsx 2>&1 | tail -10
  ```

  Expected: all tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add app/client/src/provider/book/hook/use-fetch-next-page.ts app/client/src/provider/book/hook/use-fetch-next-page.test.tsx
  git commit -m "feat: append filter params to useFetchNextPage URL"
  ```

---

## Task 11: Add filter-change re-fetch test to `useBookList`

**Files:**
- Modify: `app/client/src/provider/book/hook/use-book-list.test.tsx`

- [ ] **Step 1: Add the re-fetch test**

  In `use-book-list.test.tsx`, add these imports at the top if not already present:

  ```ts
  import { BookProvider } from '../provider';
  import { useBookListFilter } from './use-book-list-filter';
  ```

  Add this test inside `describe('useBookList', ...)`:

  ```ts
  it('re-fetches with new filter params when bookListFilter changes', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [], books: [], nextCursor: null }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <LibraryTargetProvider>
        <BookProvider>{children}</BookProvider>
      </LibraryTargetProvider>
    );

    const { result } = renderHook(
      () => ({ list: useBookList(), filter: useBookListFilter() }),
      { wrapper }
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenLastCalledWith('/api/books?take=20', {});

    act(() => result.current.filter[1]({ type: 'series' }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch).toHaveBeenLastCalledWith('/api/books?type=series&take=20', {});
  });
  ```

- [ ] **Step 2: Run to verify the new test passes**

  ```bash
  cd app/client && npx vitest run provider/book/hook/use-book-list.test.tsx 2>&1 | tail -10
  ```

  Expected: all tests PASS (the new test should pass because the provider's `setBookListFilter` already resets `bookListFetched`, triggering a re-fetch).

- [ ] **Step 3: Run full client suite**

  ```bash
  cd app/client && npx vitest run 2>&1 | tail -10
  ```

  Expected: all tests pass.

- [ ] **Step 4: Commit**

  ```bash
  git add app/client/src/provider/book/hook/use-book-list.test.tsx
  git commit -m "test: verify filter change triggers re-fetch in useBookList"
  ```

---

## Task 12: Create `FilterBar` component

**Files:**
- Create: `app/client/src/component/filter-bar/index.tsx`
- Create: `app/client/src/component/filter-bar/style.ts`
- Modify: `app/client/src/component/index.ts`

- [ ] **Step 1: Create `style.ts`**

  Create `app/client/src/component/filter-bar/style.ts`:

  ```ts
  import { createUseStyles, type Theme } from '~/provider/theme';

  export const useStyle = createUseStyles((theme: Theme) => ({
    root: {
      display: 'flex',
      gap: theme.space.md,
    },
    select: {
      ...theme.recipe.input,
      cursor: 'pointer',
      fontSize: theme.fontSize.sm,
    },
  }));
  ```

- [ ] **Step 2: Create `index.tsx`**

  Create `app/client/src/component/filter-bar/index.tsx`:

  ```tsx
  import type { BookListFilter } from '~/provider/book';

  import { useStyle } from './style';

  interface FilterBarProps {
    filter: BookListFilter;
    onChange: (filter: BookListFilter) => void;
  }

  export function FilterBar({ filter, onChange }: FilterBarProps) {
    const style = useStyle();
    return (
      <div className={style.root}>
        <select
          className={style.select}
          value={filter.type ?? ''}
          onChange={(e) =>
            onChange({
              ...filter,
              type: e.target.value === '' ? undefined : (e.target.value as BookListFilter['type']),
            })
          }
        >
          <option value="">All Types</option>
          <option value="standalone">Standalone</option>
          <option value="series">Series</option>
        </select>
        <select
          className={style.select}
          value={filter.status ?? ''}
          onChange={(e) =>
            onChange({
              ...filter,
              status:
                e.target.value === '' ? undefined : (e.target.value as BookListFilter['status']),
            })
          }
        >
          <option value="">All Statuses</option>
          <option value="not-started">Not Started</option>
          <option value="in-progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>
      </div>
    );
  }
  ```

- [ ] **Step 3: Export from component index**

  In `app/client/src/component/index.ts`, add (in alphabetical order):

  ```ts
  export { FilterBar } from './filter-bar';
  ```

- [ ] **Step 4: Run client tests**

  ```bash
  cd app/client && npx vitest run 2>&1 | tail -10
  ```

  Expected: all tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add app/client/src/component/filter-bar/index.tsx app/client/src/component/filter-bar/style.ts app/client/src/component/index.ts
  git commit -m "feat: add FilterBar component with type and status dropdowns"
  ```

---

## Task 13: Wire `FilterBar` into the Library page

**Files:**
- Modify: `app/client/src/page/library/index.tsx`

- [ ] **Step 1: Update the Library page**

  Replace the entire contents of `app/client/src/page/library/index.tsx` with:

  ```tsx
  import { useEffect, useRef } from 'react';

  import { Page, BookRow, FilterBar, SeriesRow } from '~/component';
  import { useIsAdmin } from '~/provider/auth';
  import { useBookList, useBookListFilter, useBookListItems, useFetchNextPage } from '~/provider/book';
  import { useLibraryTarget } from '~/provider/library-target';

  import { useStyle } from './style';

  export const LibraryPage = () => {
    const style = useStyle();
    const [isAdmin] = useIsAdmin();
    const [targetUsername] = useLibraryTarget();
    const [bookListFilter, setBookListFilter] = useBookListFilter();

    const [, bookListLoading, hasError, bookListError] = useBookList();
    const [bookListItems, nextCursor] = useBookListItems();
    const fetchNextPage = useFetchNextPage();
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (hasError || bookListLoading || nextCursor === null) return;
      const sentinel = sentinelRef.current;
      if (!sentinel) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            void fetchNextPage();
          }
        },
        { rootMargin: '200px' }
      );
      observer.observe(sentinel);
      return () => observer.disconnect();
    }, [fetchNextPage, hasError, bookListLoading, nextCursor]);

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
            <FilterBar filter={bookListFilter} onChange={setBookListFilter} />
            {bookListItems.map((item) =>
              item.type === 'series' ? (
                <SeriesRow key={item.seriesName} seriesName={item.seriesName} />
              ) : (
                <BookRow key={item.bookId} bookId={item.bookId} />
              )
            )}
            {nextCursor !== null && <div ref={sentinelRef} />}
            {hasError && bookListItems.length > 0 && (
              <div className={style.pageError}>
                Failed to load more books
                <br />
                <button
                  type="button"
                  className={style.retryButton}
                  onClick={() => void fetchNextPage()}
                >
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

- [ ] **Step 2: Run client tests**

  ```bash
  cd app/client && npx vitest run 2>&1 | tail -10
  ```

  Expected: all tests pass.

- [ ] **Step 3: Run full test suite (server + client)**

  ```bash
  npm test 2>&1 | tail -15
  ```

  Expected: all 1041+ tests pass.

- [ ] **Step 4: Run lint**

  ```bash
  npm run lint 2>&1 | tail -20
  ```

  Expected: no lint errors.

- [ ] **Step 5: Commit**

  ```bash
  git add app/client/src/page/library/index.tsx
  git commit -m "feat: wire FilterBar into LibraryPage"
  ```

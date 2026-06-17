# Book Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Library page's three-dropdown FilterBar with a single type-ahead SearchBar that searches by title, author, series, subject, and status using server-side filtering.

**Architecture:** The `BookListFilter` type grows to include `query`, `author`, `seriesName`, and `subjects[]`, replacing the old `type` and `subject` fields. The server `listBooksPage` gains four new WHERE conditions. A new `SearchBar` component (Option C layout: chips above + input below in one rounded container) replaces `FilterBar`; a `use-search-suggestions` hook derives grouped suggestions from loaded book data.

**Tech Stack:** TypeScript, React, JSS (react-jss), Prisma/SQLite, Vitest (client), Jest (server)

---

## File Map

**Server**
- Modify: `app/server/types.ts` — `BookListFilters` type
- Modify: `app/server/services/book-store.ts` — `listBooksPage` WHERE conditions
- Modify: `app/server/services/book-store.test.ts` — new filter tests
- Modify: `app/server/routes/ui.ts` — query param validation + filter construction
- Modify: `app/server/routes/ui.test.ts` — new param tests, remove old param tests

**Client — types & data**
- Modify: `app/client/src/provider/book/type.ts` — `BookListFilter` type
- Modify: `app/client/src/provider/book/hook/use-fetch-book-list.ts` — send new params
- Modify: `app/client/src/provider/theme/theme.ts` — add `color.chip` tokens

**Client — new component**
- Create: `app/client/src/component/search-bar/use-search-suggestions.ts`
- Create: `app/client/src/component/search-bar/use-search-suggestions.test.ts`
- Create: `app/client/src/component/search-bar/index.tsx`
- Create: `app/client/src/component/search-bar/style.ts`

**Client — wiring**
- Modify: `app/client/src/component/index.ts` — swap `FilterBar` → `SearchBar` export
- Modify: `app/client/src/page/library/index.tsx` — swap component, update empty-state copy
- Delete: `app/client/src/component/filter-bar/index.tsx`
- Delete: `app/client/src/component/filter-bar/style.ts`

---

### Task 1: Update server `BookListFilters` type

**Files:**
- Modify: `app/server/types.ts`

- [ ] **Step 1: Replace `BookListFilters` in `app/server/types.ts`**

  Replace the existing type:
  ```ts
  export type BookListFilters = {
    type?: 'standalone' | 'series';
    status?: 'not-started' | 'in-progress' | 'completed';
    subject?: string;
  };
  ```
  With:
  ```ts
  export type BookListFilters = {
    query?: string;
    author?: string;
    seriesName?: string;
    status?: 'not-started' | 'in-progress' | 'completed';
    subjects?: string[];
  };
  ```

- [ ] **Step 2: Verify the server still compiles**

  ```bash
  cd app/server && npx tsc --noEmit
  ```
  Expected: Errors referencing `type` or `subject` on `BookListFilters` (in `book-store.ts` and `ui.ts`) — these are fixed in later tasks.

- [ ] **Step 3: Commit**

  ```bash
  git add app/server/types.ts
  git commit -m "feat: update server BookListFilters type for search"
  ```

---

### Task 2: Update `listBooksPage` — remove `type`/`subject`, add new filters

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

The existing filter used `filters?.type` to set `includeStandalones`/`includeSeries`, and `filters?.subject` for a single subject. We remove those and add `query`, `author`, `seriesName`, and `subjects[]`.

Note: The `Series` Prisma model has a top-level `author` field (see schema). This means author filtering on series can use a Prisma WHERE clause directly — no raw subquery needed.

- [ ] **Step 1: Write failing tests for the new filters**

  Add a new `describe` block at the end of `app/server/services/book-store.test.ts`:

  ```ts
  describe('BookStore.listBooksPage() — search filters', () => {
    it('filters standalones by query (title contains)', async () => {
      await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'The Fifth Season', series: '' });
      await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'A Memory Called Empire', series: '' });
      const result = await bookStore.listBooksPage(OWNER, null, 20, { query: 'fifth' });
      expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
    });

    it('filters series by query (name contains)', async () => {
      await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Dune 1', series: 'Dune' });
      await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'Foundation 1', series: 'Foundation' });
      const result = await bookStore.listBooksPage(OWNER, null, 20, { query: 'dune' });
      expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    });

    it('filters standalones by author (contains, case-insensitive)', async () => {
      await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Book A', author: 'N.K. Jemisin', series: '' });
      await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'Book B', author: 'Arkady Martine', series: '' });
      const result = await bookStore.listBooksPage(OWNER, null, 20, { author: 'jemisin' });
      expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
    });

    it('filters series by author field', async () => {
      await bookStore.addBook(OWNER, 's1', stage('s1'), { ...FAKE_META, title: 'Dune 1', series: 'Dune', author: 'Frank Herbert' });
      await bookStore.addBook(OWNER, 's2', stage('s2'), { ...FAKE_META, title: 'Foundation 1', series: 'Foundation', author: 'Isaac Asimov' });
      const result = await bookStore.listBooksPage(OWNER, null, 20, { author: 'Herbert' });
      expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    });

    it('filters by seriesName: shows only the named series (no standalones)', async () => {
      await bookStore.addBook(OWNER, 's1', stage('s1'), { ...FAKE_META, title: 'Dune 1', series: 'Dune' });
      await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Standalone', series: '' });
      const result = await bookStore.listBooksPage(OWNER, null, 20, { seriesName: 'Dune' });
      expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    });

    it('filters standalones by multiple subjects (AND)', async () => {
      await bookStore.addBook(OWNER, 'b1', stage('b1'), {
        ...FAKE_META, title: 'Book A', series: '',
        subjects: ['Fantasy', 'Fiction'],
      });
      await bookStore.addBook(OWNER, 'b2', stage('b2'), {
        ...FAKE_META, title: 'Book B', series: '',
        subjects: ['Fantasy'],
      });
      // Only b1 has both subjects
      const result = await bookStore.listBooksPage(OWNER, null, 20, { subjects: ['Fantasy', 'Fiction'] });
      expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  cd app/server && npx jest book-store --no-coverage --testNamePattern="search filters" 2>&1 | tail -20
  ```
  Expected: All 6 new tests fail (type errors or filter not applied).

- [ ] **Step 3: Update `listBooksPage` in `app/server/services/book-store.ts`**

  Find the `async listBooksPage(` method. Make the following changes:

  **3a.** Replace the `includeStandalones`/`includeSeries` lines that check `filters?.type`:
  ```ts
  // Before
  const includeStandalones = !filters?.type || filters.type === 'standalone';
  const includeSeries = !filters?.type || filters.type === 'series';

  // After
  const includeStandalones = filters?.seriesName === undefined;
  const includeSeries = true;
  ```

  **3b.** Replace the existing subject filter block (search for `if (filters?.subject)`):
  ```ts
  // Before
  if (filters?.subject) {
    const jsonSubject = JSON.stringify(filters.subject);
    if (includeStandalones) {
      bookWhere = { ...bookWhere, subjects: { contains: jsonSubject } };
    }
    if (includeSeries) {
      seriesWhere = { ...seriesWhere, subjects: { contains: jsonSubject } };
    }
  }

  // After
  if (filters?.subjects?.length) {
    for (const subject of filters.subjects) {
      const jsonSubject = JSON.stringify(subject);
      if (includeStandalones) {
        bookWhere = { ...bookWhere, subjects: { contains: jsonSubject } };
      }
      if (includeSeries) {
        seriesWhere = { ...seriesWhere, subjects: { contains: jsonSubject } };
      }
    }
  }
  ```

  **3c.** After the subjects block, add the new filters. Insert before the line `// For series status filter`:
  ```ts
  // query: case-insensitive contains on book title and series name
  if (filters?.query) {
    if (includeStandalones) {
      bookWhere = { ...bookWhere, title: { contains: filters.query } };
    }
    seriesWhere = { ...seriesWhere, name: { contains: filters.query } };
  }

  // author: case-insensitive contains on book author; series has own author field
  if (filters?.author) {
    if (includeStandalones) {
      bookWhere = { ...bookWhere, author: { contains: filters.author } };
    }
    seriesWhere = { ...seriesWhere, author: { contains: filters.author } };
  }

  // seriesName: exact match — only the named series, no standalones
  if (filters?.seriesName) {
    seriesWhere = { ...seriesWhere, name: { equals: filters.seriesName } };
  }
  ```

  **3d.** The `matchingSeriesIds` block merges status-based series IDs into `finalSeriesWhere`. Update it to also support future intersection (no change needed — the existing code already uses a single `matchingSeriesIds` variable). No changes needed here.

- [ ] **Step 4: Run the new tests**

  ```bash
  cd app/server && npx jest book-store --no-coverage --testNamePattern="search filters" 2>&1 | tail -20
  ```
  Expected: All 6 pass.

- [ ] **Step 5: Run the full book-store test suite**

  ```bash
  cd app/server && npx jest book-store --no-coverage 2>&1 | tail -10
  ```
  Expected: All tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add app/server/services/book-store.ts app/server/services/book-store.test.ts
  git commit -m "feat: add query/author/seriesName/subjects[] filters to listBooksPage"
  ```

---

### Task 3: Update the `/api/books` route

**Files:**
- Modify: `app/server/routes/ui.ts`
- Modify: `app/server/routes/ui.test.ts`

- [ ] **Step 1: Write failing route tests for new params**

  Add a new `describe` block in `app/server/routes/ui.test.ts` after the existing `describe('GET /api/books (paginated)')` block:

  ```ts
  describe('GET /api/books — search params', () => {
    it('accepts query param and returns matching books', async () => {
      await bookStore.addBook(aliceOwner, 'b1', stage('b1'), { ...FAKE_META, title: 'The Fifth Season', series: '' });
      await bookStore.addBook(aliceOwner, 'b2', stage('b2'), { ...FAKE_META, title: 'Piranesi', series: '' });
      const token = await loginAlice();
      const res = await request(app)
        .get('/api/books?take=20&query=fifth')
        .set(...bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
    });

    it('accepts author param and returns matching books', async () => {
      await bookStore.addBook(aliceOwner, 'b1', stage('b1'), { ...FAKE_META, title: 'Book A', author: 'N.K. Jemisin', series: '' });
      await bookStore.addBook(aliceOwner, 'b2', stage('b2'), { ...FAKE_META, title: 'Book B', author: 'Arkady Martine', series: '' });
      const token = await loginAlice();
      const res = await request(app)
        .get('/api/books?take=20&author=Jemisin')
        .set(...bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
    });

    it('accepts seriesName param and returns only that series', async () => {
      await bookStore.addBook(aliceOwner, 'b1', stage('b1'), { ...FAKE_META, title: 'Dune 1', series: 'Dune' });
      await bookStore.addBook(aliceOwner, 'b2', stage('b2'), { ...FAKE_META, title: 'Standalone', series: '' });
      const token = await loginAlice();
      const res = await request(app)
        .get('/api/books?take=20&seriesName=Dune')
        .set(...bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    });

    it('accepts multiple subjects params (AND filter)', async () => {
      await bookStore.addBook(aliceOwner, 'b1', stage('b1'), {
        ...FAKE_META, title: 'Book A', series: '', subjects: ['Fantasy', 'Fiction'],
      });
      await bookStore.addBook(aliceOwner, 'b2', stage('b2'), {
        ...FAKE_META, title: 'Book B', series: '', subjects: ['Fantasy'],
      });
      const token = await loginAlice();
      const res = await request(app)
        .get('/api/books?take=20&subjects=Fantasy&subjects=Fiction')
        .set(...bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  cd app/server && npx jest routes/ui --no-coverage --testNamePattern="search params" 2>&1 | tail -20
  ```
  Expected: Tests fail (params not yet parsed in route).

- [ ] **Step 3: Update the route in `app/server/routes/ui.ts`**

  Find `router.get('/api/books', ...)`. Replace the param extraction and validation block:

  ```ts
  // Before
  const { cursor, take, type, status, subject } = req.query;

  if (type !== undefined && (typeof type !== 'string' || !VALID_TYPES.has(type))) {
    res.status(400).json({ error: 'Invalid type. Must be "standalone" or "series".' });
    return;
  }
  if (status !== undefined && (typeof status !== 'string' || !VALID_STATUSES.has(status))) {
    res.status(400).json({
      error: 'Invalid status. Must be "not-started", "in-progress", or "completed".',
    });
    return;
  }

  const subjectValue = typeof subject === 'string' && subject ? subject : undefined;

  const filters: BookListFilters | undefined =
    type !== undefined || status !== undefined || subjectValue !== undefined
      ? {
          type: type as BookListFilters['type'],
          status: status as BookListFilters['status'],
          subject: subjectValue,
        }
      : undefined;
  ```

  With:

  ```ts
  const { cursor, take, status, query, author, seriesName, subjects } = req.query;

  if (status !== undefined && (typeof status !== 'string' || !VALID_STATUSES.has(status))) {
    res.status(400).json({
      error: 'Invalid status. Must be "not-started", "in-progress", or "completed".',
    });
    return;
  }

  const queryValue = typeof query === 'string' && query ? query : undefined;
  const authorValue = typeof author === 'string' && author ? author : undefined;
  const seriesNameValue = typeof seriesName === 'string' && seriesName ? seriesName : undefined;
  const subjectsValue: string[] = Array.isArray(subjects)
    ? (subjects as string[]).filter((s): s is string => typeof s === 'string' && s.length > 0)
    : typeof subjects === 'string' && subjects
    ? [subjects]
    : [];

  const filters: BookListFilters | undefined =
    status !== undefined ||
    queryValue !== undefined ||
    authorValue !== undefined ||
    seriesNameValue !== undefined ||
    subjectsValue.length > 0
      ? {
          status: status as BookListFilters['status'],
          query: queryValue,
          author: authorValue,
          seriesName: seriesNameValue,
          subjects: subjectsValue.length > 0 ? subjectsValue : undefined,
        }
      : undefined;
  ```

  Also remove the `VALID_TYPES` constant since it's no longer used:
  ```ts
  // Delete this line:
  const VALID_TYPES = new Set(['standalone', 'series']);
  ```

- [ ] **Step 4: Run the new route tests**

  ```bash
  cd app/server && npx jest routes/ui --no-coverage --testNamePattern="search params" 2>&1 | tail -20
  ```
  Expected: All 4 pass.

- [ ] **Step 5: Run the full route test suite**

  ```bash
  cd app/server && npx jest routes/ui --no-coverage 2>&1 | tail -10
  ```
  Expected: All tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add app/server/routes/ui.ts app/server/routes/ui.test.ts
  git commit -m "feat: update /api/books route for search params"
  ```

---

### Task 4: Update client `BookListFilter` type and `useFetchBookList`

**Files:**
- Modify: `app/client/src/provider/book/type.ts`
- Modify: `app/client/src/provider/book/hook/use-fetch-book-list.ts`

- [ ] **Step 1: Update `BookListFilter` in `app/client/src/provider/book/type.ts`**

  Replace:
  ```ts
  export type BookListFilter = {
    type?: 'standalone' | 'series';
    status?: 'not-started' | 'in-progress' | 'completed';
    subject?: string;
  };
  ```
  With:
  ```ts
  export type BookListFilter = {
    query?: string;
    author?: string;
    seriesName?: string;
    status?: 'not-started' | 'in-progress' | 'completed';
    subjects?: string[];
  };
  ```

- [ ] **Step 2: Update `useFetchBookList` in `app/client/src/provider/book/hook/use-fetch-book-list.ts`**

  Replace the params block inside the `useCallback`:
  ```ts
  // Before
  const params = new URLSearchParams();
  if (bookListFilter.type) params.append('type', bookListFilter.type);
  if (bookListFilter.status) params.append('status', bookListFilter.status);
  if (bookListFilter.subject) params.append('subject', bookListFilter.subject);
  params.append('take', '20');

  // After
  const params = new URLSearchParams();
  if (bookListFilter.query) params.append('query', bookListFilter.query);
  if (bookListFilter.author) params.append('author', bookListFilter.author);
  if (bookListFilter.seriesName) params.append('seriesName', bookListFilter.seriesName);
  if (bookListFilter.status) params.append('status', bookListFilter.status);
  for (const subject of bookListFilter.subjects ?? []) {
    params.append('subjects', subject);
  }
  params.append('take', '20');
  ```

  Also remove `bookListFilter.type` and `bookListFilter.subject` from the `useCallback` dependency array, and add the new fields. The dep array should become:
  ```ts
  [
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
    bookListFilter,
  ]
  ```
  (No change — `bookListFilter` is already in the dep array as a whole object.)

- [ ] **Step 3: Check for TypeScript errors in client**

  ```bash
  cd app/client && npx tsc --noEmit 2>&1 | head -30
  ```
  Expected: Errors only in `filter-bar/index.tsx` (references old `BookListFilter` shape) — this is resolved when FilterBar is deleted in Task 7. No errors elsewhere.

- [ ] **Step 4: Run existing client tests**

  ```bash
  cd app/client && npx vitest run --reporter=verbose 2>&1 | tail -15
  ```
  Expected: All pass (filter-bar has no tests).

- [ ] **Step 5: Commit**

  ```bash
  git add app/client/src/provider/book/type.ts app/client/src/provider/book/hook/use-fetch-book-list.ts
  git commit -m "feat: update client BookListFilter type and fetch params"
  ```

---

### Task 5: Add `color.chip` tokens to the theme

**Files:**
- Modify: `app/client/src/provider/theme/theme.ts`

- [ ] **Step 1: Add `chip` to the `Theme` interface**

  In `app/client/src/provider/theme/theme.ts`, add `chip` inside the `color` block of the `Theme` interface (after `overlay`):

  ```ts
  chip: {
    status:  { text: string; bg: string; border: string };
    author:  { text: string; bg: string; border: string };
    series:  { text: string; bg: string; border: string };
    subject: { text: string; bg: string; border: string };
  };
  ```

- [ ] **Step 2: Add values in `buildTheme()`**

  Inside `buildTheme()`, add to the `color` object (after `overlay`):

  ```ts
  chip: {
    status:  { text: '#6d3fc0', bg: 'rgba(109,63,192,0.08)', border: 'rgba(109,63,192,0.22)' },
    author:  { text: '#1a7a52', bg: 'rgba(26,122,82,0.08)',  border: 'rgba(26,122,82,0.22)'  },
    series:  { text: '#1a5fa8', bg: 'rgba(26,95,168,0.08)',  border: 'rgba(26,95,168,0.22)'  },
    subject: { text: '#8a5e00', bg: 'rgba(138,94,0,0.08)',   border: 'rgba(138,94,0,0.22)'   },
  },
  ```

- [ ] **Step 3: Verify TypeScript**

  ```bash
  cd app/client && npx tsc --noEmit 2>&1 | grep theme
  ```
  Expected: No theme-related errors.

- [ ] **Step 4: Commit**

  ```bash
  git add app/client/src/provider/theme/theme.ts
  git commit -m "feat: add color.chip tokens to theme"
  ```

---

### Task 6: Build `use-search-suggestions` hook (TDD)

**Files:**
- Create: `app/client/src/component/search-bar/use-search-suggestions.ts`
- Create: `app/client/src/component/search-bar/use-search-suggestions.test.ts`

- [ ] **Step 1: Write the failing tests**

  Create `app/client/src/component/search-bar/use-search-suggestions.test.ts`:

  ```ts
  import { renderHook } from '@testing-library/react';
  import { describe, it, expect, vi } from 'vitest';
  import { useSearchSuggestions } from './use-search-suggestions';
  import type { BookListFilter } from '~/provider/book';

  // Mock book context and subjects hook
  vi.mock('~/provider/book', () => ({
    useBookList: () => [[
      { id: 'b1', title: 'The Fifth Season', author: 'N.K. Jemisin', series: 'Broken Earth' },
      { id: 'b2', title: 'Piranesi', author: 'Susanna Clarke', series: '' },
      { id: 'b3', title: 'The Obelisk Gate', author: 'N.K. Jemisin', series: 'Broken Earth' },
    ], false, false, undefined],
    useLibrarySubjects: () => [['Fantasy', 'Fiction', 'Science Fiction'], false, undefined],
  }));

  const emptyFilter: BookListFilter = {};

  describe('useSearchSuggestions', () => {
    it('returns empty groups when inputValue is empty', () => {
      const { result } = renderHook(() => useSearchSuggestions('', emptyFilter));
      expect(result.current).toEqual([]);
    });

    it('returns status suggestions matching the query', () => {
      const { result } = renderHook(() => useSearchSuggestions('in pr', emptyFilter));
      const statusGroup = result.current.find(g => g.type === 'status');
      expect(statusGroup).toBeDefined();
      expect(statusGroup!.items).toHaveLength(1);
      expect(statusGroup!.items[0].value).toBe('in-progress');
      expect(statusGroup!.items[0].label).toBe('In Progress');
      expect(statusGroup!.items[0].additive).toBe(false);
    });

    it('omits status group when status chip is already active', () => {
      const filter: BookListFilter = { status: 'in-progress' };
      const { result } = renderHook(() => useSearchSuggestions('in', filter));
      expect(result.current.find(g => g.type === 'status')).toBeUndefined();
    });

    it('returns author suggestions matching the query (case-insensitive, deduplicated)', () => {
      const { result } = renderHook(() => useSearchSuggestions('jemi', emptyFilter));
      const authorGroup = result.current.find(g => g.type === 'author');
      expect(authorGroup).toBeDefined();
      expect(authorGroup!.items).toHaveLength(1); // deduplicated
      expect(authorGroup!.items[0].value).toBe('N.K. Jemisin');
      expect(authorGroup!.items[0].additive).toBe(false);
    });

    it('omits author group when author chip is already active', () => {
      const filter: BookListFilter = { author: 'N.K. Jemisin' };
      const { result } = renderHook(() => useSearchSuggestions('jemi', filter));
      expect(result.current.find(g => g.type === 'author')).toBeUndefined();
    });

    it('returns series suggestions matching the query', () => {
      const { result } = renderHook(() => useSearchSuggestions('broken', emptyFilter));
      const seriesGroup = result.current.find(g => g.type === 'series');
      expect(seriesGroup).toBeDefined();
      expect(seriesGroup!.items).toHaveLength(1);
      expect(seriesGroup!.items[0].value).toBe('Broken Earth');
      expect(seriesGroup!.items[0].additive).toBe(false);
    });

    it('omits series group when seriesName chip is already active', () => {
      const filter: BookListFilter = { seriesName: 'Broken Earth' };
      const { result } = renderHook(() => useSearchSuggestions('broken', filter));
      expect(result.current.find(g => g.type === 'series')).toBeUndefined();
    });

    it('returns subject suggestions with additive=true', () => {
      const { result } = renderHook(() => useSearchSuggestions('fan', emptyFilter));
      const subjectGroup = result.current.find(g => g.type === 'subject');
      expect(subjectGroup).toBeDefined();
      expect(subjectGroup!.items[0].additive).toBe(true);
    });

    it('omits already-selected subjects from subject suggestions', () => {
      const filter: BookListFilter = { subjects: ['Fantasy'] };
      const { result } = renderHook(() => useSearchSuggestions('fan', filter));
      const subjectGroup = result.current.find(g => g.type === 'subject');
      // 'Fantasy' already active, so not in suggestions
      expect(subjectGroup?.items.find(i => i.value === 'Fantasy')).toBeUndefined();
    });

    it('includes correct matchStart and matchLength', () => {
      const { result } = renderHook(() => useSearchSuggestions('broken', emptyFilter));
      const item = result.current.find(g => g.type === 'series')!.items[0];
      expect(item.matchStart).toBe(0);
      expect(item.matchLength).toBe(6);
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  cd app/client && npx vitest run src/component/search-bar/use-search-suggestions.test.ts 2>&1 | tail -15
  ```
  Expected: All tests fail (module not found).

- [ ] **Step 3: Implement `use-search-suggestions.ts`**

  Create `app/client/src/component/search-bar/use-search-suggestions.ts`:

  ```ts
  import { useMemo } from 'react';

  import { useBookList, useLibrarySubjects } from '~/provider/book';
  import type { BookListFilter } from '~/provider/book';

  export type Suggestion = {
    type: 'status' | 'author' | 'series' | 'subject';
    label: string;
    value: string;
    additive: boolean;
    matchStart: number;
    matchLength: number;
  };

  export type SuggestionGroup = {
    type: Suggestion['type'];
    label: string;
    items: Suggestion[];
  };

  const STATUS_OPTIONS: { label: string; value: string }[] = [
    { label: 'Not Started', value: 'not-started' },
    { label: 'In Progress', value: 'in-progress' },
    { label: 'Completed', value: 'completed' },
  ];

  function matchInfo(text: string, query: string): { matchStart: number; matchLength: number } | null {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return null;
    return { matchStart: idx, matchLength: query.length };
  }

  function buildGroup(
    type: Suggestion['type'],
    label: string,
    candidates: { label: string; value: string }[],
    query: string,
    additive: boolean,
    exclude: Set<string>
  ): SuggestionGroup | null {
    const items: Suggestion[] = [];
    for (const c of candidates) {
      if (exclude.has(c.value)) continue;
      const info = matchInfo(c.label, query);
      if (!info) continue;
      items.push({ type, label: c.label, value: c.value, additive, ...info });
    }
    if (items.length === 0) return null;
    return { type, label, items };
  }

  export function useSearchSuggestions(
    inputValue: string,
    filter: BookListFilter
  ): SuggestionGroup[] {
    const [bookList] = useBookList();
    const [subjects] = useLibrarySubjects();

    return useMemo(() => {
      const query = inputValue.trim();
      if (!query) return [];

      const groups: SuggestionGroup[] = [];

      // Status (exclusive)
      if (!filter.status) {
        const g = buildGroup('status', 'Status', STATUS_OPTIONS, query, false, new Set());
        if (g) groups.push(g);
      }

      // Author (exclusive) — deduplicate by value
      if (!filter.author) {
        const seen = new Set<string>();
        const authors: { label: string; value: string }[] = [];
        for (const book of bookList) {
          if (book.author && !seen.has(book.author)) {
            seen.add(book.author);
            authors.push({ label: book.author, value: book.author });
          }
        }
        const g = buildGroup('author', 'Author', authors, query, false, new Set());
        if (g) groups.push(g);
      }

      // Series (exclusive) — deduplicate by value
      if (!filter.seriesName) {
        const seen = new Set<string>();
        const seriesList: { label: string; value: string }[] = [];
        for (const book of bookList) {
          if (book.series && !seen.has(book.series)) {
            seen.add(book.series);
            seriesList.push({ label: book.series, value: book.series });
          }
        }
        const g = buildGroup('series', 'Series', seriesList, query, false, new Set());
        if (g) groups.push(g);
      }

      // Subject (additive) — exclude already-active subjects
      const activeSubjects = new Set(filter.subjects ?? []);
      const subjectCandidates = (subjects ?? []).map(s => ({ label: s, value: s }));
      const g = buildGroup('subject', 'Subject', subjectCandidates, query, true, activeSubjects);
      if (g) groups.push(g);

      return groups;
    }, [inputValue, filter, bookList, subjects]);
  }
  ```

- [ ] **Step 4: Run tests**

  ```bash
  cd app/client && npx vitest run src/component/search-bar/use-search-suggestions.test.ts 2>&1 | tail -15
  ```
  Expected: All tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add app/client/src/component/search-bar/use-search-suggestions.ts \
          app/client/src/component/search-bar/use-search-suggestions.test.ts
  git commit -m "feat: add use-search-suggestions hook with TDD"
  ```

---

### Task 7: Build `SearchBar` component

**Files:**
- Create: `app/client/src/component/search-bar/style.ts`
- Create: `app/client/src/component/search-bar/index.tsx`

- [ ] **Step 1: Create `style.ts`**

  Create `app/client/src/component/search-bar/style.ts`:

  ```ts
  import { createUseStyles, type Theme } from '~/provider/theme';

  export const useStyle = createUseStyles((theme: Theme) => ({
    root: {
      background: theme.color.bg.input,
      border: `1px solid ${theme.color.border.default}`,
      borderRadius: theme.radius.lg,
      position: 'relative',
      '&$focused': {
        borderColor: theme.color.border.focus,
        boxShadow: `0 0 0 2px ${theme.color.brand.outline}`,
      },
    },
    focused: {},
    chipsRow: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: theme.space.sm,
      padding: `${theme.space.md} ${theme.space.xxl} ${theme.space.sm}`,
    },
    divider: {
      height: '1px',
      background: theme.color.border.strong,
      margin: `0 ${theme.space.xxl}`,
    },
    inputRow: {
      display: 'flex',
      alignItems: 'center',
      gap: theme.space.md,
      padding: `${theme.space.md} ${theme.space.xxl}`,
    },
    searchIcon: {
      color: theme.color.text.faint,
      flexShrink: 0,
      fontSize: theme.fontSize.lg,
      lineHeight: 1,
      userSelect: 'none',
    },
    input: {
      flex: 1,
      background: 'none',
      border: 'none',
      outline: 'none',
      color: theme.color.text.primary,
      fontSize: theme.fontSize.md,
      lineHeight: theme.lineHeight.body,
      fontFamily: theme.fontFamily.body,
      '&::placeholder': { color: theme.color.text.faint },
    },
    clearButton: {
      color: theme.color.text.faint,
      fontSize: theme.fontSize.sm,
      cursor: 'pointer',
      flexShrink: 0,
      background: 'none',
      border: 'none',
      padding: 0,
      lineHeight: 1,
      '&:hover': { color: theme.color.text.muted },
    },
    // Chip base
    chip: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.space.xs,
      padding: `${theme.space.xs} ${theme.space.md} ${theme.space.xs} ${theme.space.sm}`,
      borderRadius: theme.radius.sm,
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.medium,
      whiteSpace: 'nowrap',
      border: '1px solid transparent',
    },
    chipTypeLabel: {
      fontSize: theme.fontSize.xxs,
      fontWeight: theme.fontWeight.bold,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      opacity: 0.65,
      marginRight: '1px',
    },
    chipRemove: {
      opacity: 0.4,
      fontSize: theme.fontSize.xxs,
      marginLeft: theme.space.xs,
      cursor: 'pointer',
      background: 'none',
      border: 'none',
      padding: 0,
      lineHeight: 1,
      color: 'inherit',
      '&:hover': { opacity: 0.8 },
    },
    chipStatus:  { color: theme.color.chip.status.text,  background: theme.color.chip.status.bg,  borderColor: theme.color.chip.status.border  },
    chipAuthor:  { color: theme.color.chip.author.text,  background: theme.color.chip.author.bg,  borderColor: theme.color.chip.author.border  },
    chipSeries:  { color: theme.color.chip.series.text,  background: theme.color.chip.series.bg,  borderColor: theme.color.chip.series.border  },
    chipSubject: { color: theme.color.chip.subject.text, background: theme.color.chip.subject.bg, borderColor: theme.color.chip.subject.border },
    // Dropdown
    dropdown: {
      position: 'absolute',
      top: 'calc(100% + 4px)',
      left: 0,
      right: 0,
      zIndex: theme.zIndex.sticky,
      background: theme.color.bg.card,
      border: `1px solid ${theme.color.border.default}`,
      borderRadius: theme.radius.md,
      boxShadow: theme.shadow.hoverLift,
      overflow: 'hidden',
    },
    dropdownGroup: {
      padding: `${theme.space.xs} 0`,
      '& + &': { borderTop: `1px solid ${theme.color.border.strong}` },
    },
    dropdownGroupLabel: {
      padding: `${theme.space.xs} ${theme.space.xxl} ${theme.space.xxxs}`,
      fontSize: theme.fontSize.xxs,
      fontWeight: theme.fontWeight.bold,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: theme.color.text.faint,
    },
    dropdownItem: {
      display: 'flex',
      alignItems: 'center',
      gap: theme.space.md,
      padding: `${theme.space.lg} ${theme.space.xxl}`,
      fontSize: theme.fontSize.sm,
      color: theme.color.text.primary,
      cursor: 'pointer',
      '&:hover, &$dropdownItemHighlighted': { background: theme.color.bg.cardHeader },
    },
    dropdownItemHighlighted: {},
    dropdownItemType: {
      fontSize: theme.fontSize.xxs,
      padding: `1px ${theme.space.sm}`,
      borderRadius: theme.radius.sm,
      fontWeight: theme.fontWeight.bold,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      flexShrink: 0,
    },
    dropdownItemTypeStatus:  { color: theme.color.chip.status.text,  background: theme.color.chip.status.bg  },
    dropdownItemTypeAuthor:  { color: theme.color.chip.author.text,  background: theme.color.chip.author.bg  },
    dropdownItemTypeSeries:  { color: theme.color.chip.series.text,  background: theme.color.chip.series.bg  },
    dropdownItemTypeSubject: { color: theme.color.chip.subject.text, background: theme.color.chip.subject.bg },
    dropdownItemText: { flex: 1, minWidth: 0 },
    dropdownItemMatch: { fontWeight: theme.fontWeight.bold },
    dropdownItemAdditive: {
      marginLeft: 'auto',
      fontSize: theme.fontSize.xxs,
      fontWeight: theme.fontWeight.bold,
      color: theme.color.chip.subject.text,
      opacity: 0.7,
    },
  }));
  ```

- [ ] **Step 2: Create `index.tsx`**

  Create `app/client/src/component/search-bar/index.tsx`:

  ```tsx
  import cx from 'classnames';
  import { useCallback, useEffect, useRef, useState } from 'react';

  import type { BookListFilter } from '~/provider/book';
  import type { Suggestion, SuggestionGroup } from './use-search-suggestions';
  import { useSearchSuggestions } from './use-search-suggestions';
  import { useStyle } from './style';

  const STATUS_LABELS: Record<string, string> = {
    'not-started': 'Not Started',
    'in-progress': 'In Progress',
    completed: 'Completed',
  };

  type ChipDef =
    | { kind: 'status'; value: string }
    | { kind: 'author'; value: string }
    | { kind: 'series'; value: string }
    | { kind: 'subject'; value: string };

  function filterToChips(filter: BookListFilter): ChipDef[] {
    const chips: ChipDef[] = [];
    if (filter.status) chips.push({ kind: 'status', value: STATUS_LABELS[filter.status] ?? filter.status });
    if (filter.author) chips.push({ kind: 'author', value: filter.author });
    if (filter.seriesName) chips.push({ kind: 'series', value: filter.seriesName });
    for (const s of filter.subjects ?? []) chips.push({ kind: 'subject', value: s });
    return chips;
  }

  function removeChip(filter: BookListFilter, chip: ChipDef): BookListFilter {
    switch (chip.kind) {
      case 'status':  return { ...filter, status: undefined };
      case 'author':  return { ...filter, author: undefined };
      case 'series':  return { ...filter, seriesName: undefined };
      case 'subject': return { ...filter, subjects: filter.subjects?.filter(s => s !== chip.value) };
    }
  }

  function applySelection(filter: BookListFilter, suggestion: Suggestion): BookListFilter {
    switch (suggestion.type) {
      case 'status':  return { ...filter, status: suggestion.value as BookListFilter['status'] };
      case 'author':  return { ...filter, author: suggestion.value };
      case 'series':  return { ...filter, seriesName: suggestion.value };
      case 'subject': return { ...filter, subjects: [...(filter.subjects ?? []), suggestion.value] };
    }
  }

  function renderHighlighted(
    text: string,
    matchStart: number,
    matchLength: number,
    matchClass: string
  ): React.ReactNode {
    if (matchLength === 0) return text;
    return (
      <>
        {text.slice(0, matchStart)}
        <span className={matchClass}>{text.slice(matchStart, matchStart + matchLength)}</span>
        {text.slice(matchStart + matchLength)}
      </>
    );
  }

  const TYPE_CHIP_CLASS: Record<ChipDef['kind'], string> = {
    status: 'chipStatus',
    author: 'chipAuthor',
    series: 'chipSeries',
    subject: 'chipSubject',
  };

  const TYPE_CHIP_LABEL: Record<ChipDef['kind'], string> = {
    status: 'Status',
    author: 'Author',
    series: 'Series',
    subject: 'Subject',
  };

  const TYPE_DROPDOWN_CLASS: Record<Suggestion['type'], string> = {
    status: 'dropdownItemTypeStatus',
    author: 'dropdownItemTypeAuthor',
    series: 'dropdownItemTypeSeries',
    subject: 'dropdownItemTypeSubject',
  };

  interface SearchBarProps {
    filter: BookListFilter;
    onChange: (filter: BookListFilter) => void;
  }

  export function SearchBar({ filter, onChange }: SearchBarProps) {
    const style = useStyle();
    const [inputValue, setInputValue] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    const suggestions = useSearchSuggestions(inputValue, filter);
    const flatSuggestions: Suggestion[] = suggestions.flatMap(g => g.items);

    const chips = filterToChips(filter);
    const hasAnyActive = chips.length > 0 || !!filter.query;

    const open = useCallback(() => {
      setIsOpen(true);
      setHighlightedIndex(0);
    }, []);

    const close = useCallback(() => {
      setIsOpen(false);
      setHighlightedIndex(0);
    }, []);

    const commitQuery = useCallback(() => {
      const q = inputValue.trim();
      if (q) onChange({ ...filter, query: q });
      else if (filter.query) onChange({ ...filter, query: undefined });
      close();
    }, [inputValue, filter, onChange, close]);

    const selectSuggestion = useCallback(
      (suggestion: Suggestion) => {
        onChange(applySelection(filter, suggestion));
        setInputValue('');
        close();
      },
      [filter, onChange, close]
    );

    const clearAll = useCallback(() => {
      onChange({});
      setInputValue('');
      close();
    }, [onChange, close]);

    // Close on outside click
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, [close]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHighlightedIndex(i =>
            flatSuggestions.length === 0 ? 0 : (i + 1) % flatSuggestions.length
          );
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHighlightedIndex(i =>
            flatSuggestions.length === 0 ? 0 : (i - 1 + flatSuggestions.length) % flatSuggestions.length
          );
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const s = flatSuggestions[highlightedIndex];
          if (s) selectSuggestion(s);
          else commitQuery();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      },
      [flatSuggestions, highlightedIndex, selectSuggestion, commitQuery, close]
    );

    let flatIndex = 0;

    return (
      <div ref={rootRef} className={cx(style.root, { [style.focused]: isOpen })}>
        {chips.length > 0 && (
          <>
            <div className={style.chipsRow}>
              {chips.map((chip, i) => (
                <span
                  key={`${chip.kind}-${chip.value}-${i}`}
                  className={cx(style.chip, style[TYPE_CHIP_CLASS[chip.kind] as keyof typeof style])}
                >
                  <span className={style.chipTypeLabel}>{TYPE_CHIP_LABEL[chip.kind]}</span>
                  {chip.value}
                  <button
                    type="button"
                    className={style.chipRemove}
                    aria-label={`Remove ${chip.kind} filter`}
                    onClick={() => onChange(removeChip(filter, chip))}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className={style.divider} />
          </>
        )}
        <div className={style.inputRow}>
          <span className={style.searchIcon} aria-hidden>⌕</span>
          <input
            ref={inputRef}
            className={style.input}
            placeholder={chips.length > 0 ? 'Search titles…' : 'Search by title, author, series, subject, or status…'}
            value={inputValue}
            onChange={e => {
              setInputValue(e.target.value);
              setHighlightedIndex(0);
              if (!isOpen) open();
            }}
            onFocus={open}
            onKeyDown={handleKeyDown}
            aria-label="Search library"
            aria-expanded={isOpen}
            aria-autocomplete="list"
          />
          {hasAnyActive && (
            <button type="button" className={style.clearButton} aria-label="Clear search" onClick={clearAll}>
              ✕
            </button>
          )}
        </div>
        {isOpen && flatSuggestions.length > 0 && (
          <div className={style.dropdown} role="listbox">
            {suggestions.map(group => (
              <div key={group.type} className={style.dropdownGroup}>
                <div className={style.dropdownGroupLabel}>{group.label}</div>
                {group.items.map(item => {
                  const idx = flatIndex++;
                  return (
                    <div
                      key={item.value}
                      className={cx(style.dropdownItem, {
                        [style.dropdownItemHighlighted]: idx === highlightedIndex,
                      })}
                      role="option"
                      aria-selected={idx === highlightedIndex}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => selectSuggestion(item)}
                    >
                      <span className={cx(style.dropdownItemType, style[TYPE_DROPDOWN_CLASS[item.type] as keyof typeof style])}>
                        {group.label}
                      </span>
                      <span className={style.dropdownItemText}>
                        {renderHighlighted(item.label, item.matchStart, item.matchLength, style.dropdownItemMatch)}
                      </span>
                      {item.additive && <span className={style.dropdownItemAdditive}>＋</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 3: Check TypeScript**

  ```bash
  cd app/client && npx tsc --noEmit 2>&1 | grep search-bar
  ```
  Expected: No errors in search-bar files.

- [ ] **Step 4: Commit**

  ```bash
  git add app/client/src/component/search-bar/
  git commit -m "feat: add SearchBar component with chip-above layout"
  ```

---

### Task 8: Wire up `LibraryPage`, update exports, delete `FilterBar`

**Files:**
- Modify: `app/client/src/component/index.ts`
- Modify: `app/client/src/page/library/index.tsx`
- Delete: `app/client/src/component/filter-bar/index.tsx`
- Delete: `app/client/src/component/filter-bar/style.ts`

- [ ] **Step 1: Update `app/client/src/component/index.ts`**

  Replace:
  ```ts
  export { FilterBar } from './filter-bar';
  ```
  With:
  ```ts
  export { SearchBar } from './search-bar';
  ```

- [ ] **Step 2: Update `app/client/src/page/library/index.tsx`**

  Replace the `FilterBar` import with `SearchBar`:
  ```ts
  // Before
  import { Page, BookRow, FilterBar, SeriesRow } from '~/component';

  // After
  import { Page, BookRow, SearchBar, SeriesRow } from '~/component';
  ```

  Remove the `isFilterActive` computation and replace `<FilterBar ... />` with `<SearchBar ... />`:
  ```tsx
  // Remove these lines:
  const isFilterActive =
    bookListFilter.type !== undefined ||
    bookListFilter.status !== undefined ||
    !!bookListFilter.subject;

  // Replace:
  <FilterBar filter={bookListFilter} onChange={setBookListFilter} />

  // With:
  <SearchBar filter={bookListFilter} onChange={setBookListFilter} />
  ```

  Update the empty state copy when filters are active. Find the empty state subtitle:
  ```tsx
  // Before
  <div className={style.emptyStateTitle}>
    {isFilterActive ? 'No books match these filters' : 'Your library is empty'}
  </div>
  <div className={style.emptyStateSubtitle}>
    {isFilterActive
      ? 'Try adjusting or clearing the filters above'
      : 'No books have been added yet'}
  </div>

  // After
  ```
  First compute `isSearchActive`:
  ```tsx
  const isSearchActive =
    !!bookListFilter.query ||
    !!bookListFilter.author ||
    !!bookListFilter.seriesName ||
    !!bookListFilter.status ||
    (bookListFilter.subjects?.length ?? 0) > 0;
  ```
  Then:
  ```tsx
  <div className={style.emptyStateTitle}>
    {isSearchActive ? 'No books match your search' : 'Your library is empty'}
  </div>
  <div className={style.emptyStateSubtitle}>
    {isSearchActive
      ? 'Try adjusting or clearing the filters above'
      : 'No books have been added yet'}
  </div>
  ```

- [ ] **Step 3: Delete FilterBar files**

  ```bash
  rm app/client/src/component/filter-bar/index.tsx app/client/src/component/filter-bar/style.ts
  rmdir app/client/src/component/filter-bar
  ```

- [ ] **Step 4: TypeScript check**

  ```bash
  cd app/client && npx tsc --noEmit 2>&1
  ```
  Expected: No errors.

- [ ] **Step 5: Run full test suite**

  ```bash
  cd app/client && npx vitest run 2>&1 | tail -10
  ```
  Expected: All tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add app/client/src/component/index.ts \
          app/client/src/page/library/index.tsx
  git rm app/client/src/component/filter-bar/index.tsx \
         app/client/src/component/filter-bar/style.ts
  git commit -m "feat: wire SearchBar into LibraryPage, remove FilterBar"
  ```

---

### Task 9: Full test run + lint

- [ ] **Step 1: Run all tests**

  From the repo root:
  ```bash
  npm test 2>&1 | tail -20
  ```
  Expected: All 1155+ tests pass.

- [ ] **Step 2: Run lint**

  ```bash
  npm run lint 2>&1 | tail -20
  ```
  Expected: No errors.

- [ ] **Step 3: Final commit if any lint fixes were needed**

  If lint auto-fixed anything:
  ```bash
  git add -p
  git commit -m "chore: lint fixes"
  ```

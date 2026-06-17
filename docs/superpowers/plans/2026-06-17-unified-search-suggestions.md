# Unified Search Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace four separate paginated suggestion endpoints and their eager-fetch client hooks with a single `GET /api/search/suggestions` endpoint that does server-side text matching and returns pre-grouped, pre-filtered results.

**Architecture:** The server runs parallel DB queries (authors, series, books, subjects) scoped to the active filter chips, caps at 5 per group, and returns pre-matched results. The client sends the debounced query + active chips, receives pre-matched groups, computes highlight offsets locally, and prepends the static status group. A loading spinner shows in the dropdown while in-flight.

**Tech Stack:** TypeScript, Node.js/Express, Prisma/SQLite (server); React, react-jss, Vitest (client)

---

## File Map

**Created:**
- none

**Modified:**
- `app/server/types.ts` — add `SearchSuggestionsResponse` type
- `app/server/services/book-store.ts` — add `getSearchSuggestions`; remove `listAuthors`, `listSeriesNames`, `listBookTitles`; revert `getSubjects` to no-filter form
- `app/server/services/book-store.test.ts` — add `getSearchSuggestions` test suite; remove old suggestion tests
- `app/server/routes/ui.ts` — add `GET /api/search/suggestions`; remove `/api/authors`, `/api/series-names`, `/api/books/titles`; revert `/api/subjects` to no-filter form
- `app/client/src/component/search-bar/use-search-suggestions.ts` — full rewrite as fetch hook
- `app/client/src/component/search-bar/use-search-suggestions.test.ts` — full rewrite
- `app/client/src/component/search-bar/index.tsx` — consume `{ groups, loading }`; add spinner
- `app/client/src/component/search-bar/style.ts` — add `dropdownLoading`, `dropdownSpinner` styles
- `app/client/src/provider/book/hook/use-library-subjects.ts` — revert filter params (remove `filters?` param)
- `app/client/src/provider/book/hook/index.ts` — remove deleted hook exports
- `app/client/src/provider/book/index.ts` — remove deleted hook exports

**Deleted:**
- `app/client/src/provider/book/hook/use-all-authors.ts`
- `app/client/src/provider/book/hook/use-all-series-names.ts`
- `app/client/src/provider/book/hook/use-all-book-titles.ts`

---

## Task 1: Server type + `getSearchSuggestions` store method

**Files:**
- Modify: `app/server/types.ts`
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

- [ ] **Step 1: Add `SearchSuggestionsResponse` to `app/server/types.ts`**

Add after the `BookListFilters` type (around line 92):

```ts
export type SearchSuggestionsResponse = {
  groups: Array<{
    type: 'author' | 'series' | 'book' | 'subject';
    items: Array<{ label: string; value: string }>;
  }>;
};
```

- [ ] **Step 2: Import `SearchSuggestionsResponse` in `app/server/services/book-store.ts`**

The existing import line (line ~6-13) is:
```ts
import {
  Book,
  BookSummary,
  EpubMeta,
  Owner,
  PageCursor,
  PagedBookListResponse,
  BookListFilters,
} from '../types';
```

Add `SearchSuggestionsResponse` to it:
```ts
import {
  Book,
  BookSummary,
  EpubMeta,
  Owner,
  PageCursor,
  PagedBookListResponse,
  BookListFilters,
  SearchSuggestionsResponse,
} from '../types';
```

- [ ] **Step 3: Write failing tests in `app/server/services/book-store.test.ts`**

Add this block after the closing `});` of the `describe('getSubjects', ...)` block (around line 2096):

```ts
describe('getSearchSuggestions', () => {
  it('returns matching authors', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Piranesi',
      author: 'Susanna Clarke',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'jemi', filter: {} });
    const authors = result.groups.find((g) => g.type === 'author');
    expect(authors?.items).toEqual([{ label: 'N.K. Jemisin', value: 'N.K. Jemisin' }]);
  });

  it('returns matching series', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: 'Broken Earth',
      seriesIndex: 1,
      subjects: [],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'broken', filter: {} });
    const series = result.groups.find((g) => g.type === 'series');
    expect(series?.items).toEqual([{ label: 'Broken Earth', value: 'Broken Earth' }]);
  });

  it('returns matching book titles', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'fifth', filter: {} });
    const books = result.groups.find((g) => g.type === 'book');
    expect(books?.items).toEqual([{ label: 'The Fifth Season', value: 'b1' }]);
  });

  it('returns matching subjects', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Foo',
      author: 'Author',
      series: '',
      seriesIndex: 0,
      subjects: ['Fantasy', 'Science Fiction'],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'fan', filter: {} });
    const subjects = result.groups.find((g) => g.type === 'subject');
    expect(subjects?.items).toEqual([{ label: 'Fantasy', value: 'Fantasy' }]);
  });

  it('excludes active subject chips from subject group', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Foo',
      author: 'Author',
      series: '',
      seriesIndex: 0,
      subjects: ['Fantasy', 'Fantastic Voyage'],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, {
      q: 'fan',
      filter: { activeSubjects: ['Fantasy'] },
    });
    const subjects = result.groups.find((g) => g.type === 'subject');
    expect(subjects?.items.map((i) => i.value)).toEqual(['Fantastic Voyage']);
  });

  it('omits author group when filter.author is set', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Foo',
      author: 'N.K. Jemisin',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, {
      q: 'jemi',
      filter: { author: 'N.K. Jemisin' },
    });
    expect(result.groups.find((g) => g.type === 'author')).toBeUndefined();
  });

  it('omits series group when filter.seriesName is set', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Foo',
      author: 'Author',
      series: 'Broken Earth',
      seriesIndex: 1,
      subjects: [],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, {
      q: 'broken',
      filter: { seriesName: 'Broken Earth' },
    });
    expect(result.groups.find((g) => g.type === 'series')).toBeUndefined();
  });

  it('constrains series to active author filter', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: 'Broken Earth',
      seriesIndex: 1,
      subjects: [],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Piranesi',
      author: 'Susanna Clarke',
      series: 'Broken Earth Fake',
      seriesIndex: 1,
      subjects: [],
    });
    // Only Jemisin's series should appear when author filter is set
    const result = await bookStore.getSearchSuggestions(OWNER, {
      q: 'broken',
      filter: { author: 'N.K. Jemisin' },
    });
    const series = result.groups.find((g) => g.type === 'series');
    expect(series?.items.map((i) => i.value)).toEqual(['Broken Earth']);
  });

  it('caps each group at 5 items', async () => {
    for (let i = 0; i < 7; i++) {
      await bookStore.addBook(OWNER, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Alpha Book ${i}`,
        author: `Author${i}`,
        series: '',
        seriesIndex: 0,
        subjects: [],
      });
    }
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'alpha', filter: {} });
    const books = result.groups.find((g) => g.type === 'book');
    expect(books?.items.length).toBeLessThanOrEqual(5);
  });

  it('returns empty groups for query that matches nothing', async () => {
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'zzznomatch', filter: {} });
    expect(result.groups).toEqual([]);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
cd /Users/korzun/Code/HASS-ODPS/app/server && npx jest book-store.test.ts -t "getSearchSuggestions" 2>&1 | tail -20
```

Expected: FAIL — `bookStore.getSearchSuggestions is not a function`

- [ ] **Step 5: Implement `getSearchSuggestions` in `app/server/services/book-store.ts`**

Add this method immediately after `getSubjects` (after line ~216, before `getUserDir`):

```ts
async getSearchSuggestions(
  owner: Owner,
  {
    q,
    filter,
  }: {
    q: string;
    filter: { author?: string; seriesName?: string; activeSubjects?: string[] };
  }
): Promise<SearchSuggestionsResponse> {
  const groups: SearchSuggestionsResponse['groups'] = [];

  if (!filter.author) {
    const rows = await this.prisma.book.groupBy({
      by: ['author'],
      where: {
        userId: owner.userId,
        author: { contains: q },
        ...(filter.seriesName ? { series: filter.seriesName } : {}),
      },
      orderBy: { author: 'asc' },
      take: 5,
    });
    if (rows.length > 0)
      groups.push({
        type: 'author',
        items: rows.map((r) => ({ label: r.author, value: r.author })),
      });
  }

  if (!filter.seriesName) {
    const rows = await this.prisma.series.findMany({
      where: {
        userId: owner.userId,
        name: { contains: q },
        ...(filter.author ? { books: { some: { author: filter.author } } } : {}),
      },
      select: { name: true },
      orderBy: { name: 'asc' },
      take: 5,
    });
    if (rows.length > 0)
      groups.push({
        type: 'series',
        items: rows.map((r) => ({ label: r.name, value: r.name })),
      });
  }

  const [bookRows, subjectRows] = await Promise.all([
    this.prisma.book.findMany({
      where: {
        userId: owner.userId,
        title: { contains: q },
        ...(filter.author ? { author: filter.author } : {}),
        ...(filter.seriesName ? { series: filter.seriesName } : {}),
      },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
      take: 5,
    }),
    this.prisma.$queryRaw<Array<{ value: string }>>`
      SELECT DISTINCT trim(CAST(json_each.value AS TEXT)) AS value
      FROM books, json_each(books.subjects)
      WHERE user_id = ${owner.userId}
        AND LOWER(trim(CAST(json_each.value AS TEXT))) LIKE LOWER(${'%' + q + '%'})
        ${filter.author ? Prisma.sql`AND author = ${filter.author}` : Prisma.empty}
        ${filter.seriesName ? Prisma.sql`AND series = ${filter.seriesName}` : Prisma.empty}
        AND json_each.type = 'text'
        AND trim(CAST(json_each.value AS TEXT)) <> ''
      ORDER BY value
      LIMIT 5
    `,
  ]);

  if (bookRows.length > 0)
    groups.push({
      type: 'book',
      items: bookRows.map((r) => ({ label: r.title, value: r.id })),
    });

  const activeSubjectSet = new Set(filter.activeSubjects ?? []);
  const filteredSubjects = subjectRows.filter((r) => !activeSubjectSet.has(r.value));
  if (filteredSubjects.length > 0)
    groups.push({
      type: 'subject',
      items: filteredSubjects.map((r) => ({ label: r.value, value: r.value })),
    });

  return { groups };
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/korzun/Code/HASS-ODPS/app/server && npx jest book-store.test.ts -t "getSearchSuggestions" 2>&1 | tail -10
```

Expected: all `getSearchSuggestions` tests PASS

- [ ] **Step 7: Run full server test suite**

```bash
cd /Users/korzun/Code/HASS-ODPS/app/server && npx jest 2>&1 | tail -5
```

Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add app/server/types.ts app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: add getSearchSuggestions store method with server-side text matching"
```

---

## Task 2: Add `GET /api/search/suggestions` route

**Files:**
- Modify: `app/server/routes/ui.ts`

- [ ] **Step 1: Add `SearchSuggestionsResponse` to the types import in `app/server/routes/ui.ts`**

The existing import (line ~14):
```ts
import { AppConfig, BookListFilters, EpubMeta, Owner, PageCursor } from '../types';
```

Change to:
```ts
import { AppConfig, BookListFilters, EpubMeta, Owner, PageCursor, SearchSuggestionsResponse } from '../types';
```

- [ ] **Step 2: Add the route to `app/server/routes/ui.ts`**

Find the `/api/subjects` route (around line 470). Add the new route **before** it:

```ts
  router.get('/api/search/suggestions', requireAuth, async (req: Request, res: Response) => {
    const owner = await resolveOwner(req, res);
    if (!owner) return;
    const { q, author, seriesName, subjects } = req.query;
    if (!q || typeof q !== 'string' || !q.trim()) {
      res.json({ groups: [] } satisfies SearchSuggestionsResponse);
      return;
    }
    const activeSubjects: string[] = Array.isArray(subjects)
      ? (subjects as string[]).filter((s): s is string => typeof s === 'string' && s.length > 0)
      : typeof subjects === 'string' && subjects
        ? [subjects]
        : [];
    const result = await bookStore.getSearchSuggestions(owner, {
      q: q.trim(),
      filter: {
        author: typeof author === 'string' && author ? author : undefined,
        seriesName: typeof seriesName === 'string' && seriesName ? seriesName : undefined,
        activeSubjects,
      },
    });
    res.json(result);
  });
```

- [ ] **Step 3: Run the full test suite to confirm nothing is broken**

```bash
cd /Users/korzun/Code/HASS-ODPS && npm test 2>&1 | grep -E "Tests:|FAIL" | head -5
```

Expected: all tests pass (the new route has no test yet — that comes in Task 3 with the client hook integration)

- [ ] **Step 4: Commit**

```bash
git add app/server/routes/ui.ts
git commit -m "feat: add GET /api/search/suggestions route"
```

---

## Task 3: Rewrite `useSearchSuggestions` client hook

**Files:**
- Modify: `app/client/src/component/search-bar/use-search-suggestions.ts`
- Modify: `app/client/src/component/search-bar/use-search-suggestions.test.ts`

- [ ] **Step 1: Rewrite `app/client/src/component/search-bar/use-search-suggestions.test.ts`**

Replace the entire file contents with:

```ts
import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '~/lib/api-fetch';
import type { BookListFilter } from '~/provider/book';

import { useSearchSuggestions } from './use-search-suggestions';

vi.mock('~/provider/library-target', () => ({
  useWithTargetUser: () => (url: string) => url,
}));

vi.mock('~/lib/api-fetch');

const makeResponse = (groups: unknown[]) =>
  new Response(JSON.stringify({ groups }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const emptyFilter: BookListFilter = {};

describe('useSearchSuggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(apiFetch).mockResolvedValue(makeResponse([]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty groups and loading=false when inputValue is empty', () => {
    const { result } = renderHook(() => useSearchSuggestions('', emptyFilter));
    expect(result.current.groups).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });

  it('does not fire a request before the 200ms debounce elapses', () => {
    renderHook(() => useSearchSuggestions('jemi', emptyFilter));
    act(() => { vi.advanceTimersByTime(199); });
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });

  it('fires a request after 200ms', () => {
    renderHook(() => useSearchSuggestions('jemi', emptyFilter));
    act(() => { vi.advanceTimersByTime(200); });
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
  });

  it('sets loading=true after debounce fires and before response arrives', () => {
    vi.mocked(apiFetch).mockImplementation(() => new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useSearchSuggestions('jemi', emptyFilter));
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current.loading).toBe(true);
  });

  it('sets loading=false after response arrives', async () => {
    vi.mocked(apiFetch).mockResolvedValue(makeResponse([]));
    const { result } = renderHook(() => useSearchSuggestions('jemi', emptyFilter));
    act(() => { vi.advanceTimersByTime(200); });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('prepends status group from client-side match before server groups', async () => {
    vi.mocked(apiFetch).mockResolvedValue(makeResponse([]));
    const { result } = renderHook(() => useSearchSuggestions('in pr', emptyFilter));
    act(() => { vi.advanceTimersByTime(200); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const statusGroup = result.current.groups.find((g) => g.type === 'status');
    expect(statusGroup).toBeDefined();
    expect(statusGroup!.items).toHaveLength(1);
    expect(statusGroup!.items[0].value).toBe('in-progress');
    expect(statusGroup!.items[0].additive).toBe(false);
  });

  it('omits status group when filter.status is already set', async () => {
    vi.mocked(apiFetch).mockResolvedValue(makeResponse([]));
    const { result } = renderHook(() =>
      useSearchSuggestions('in pr', { status: 'in-progress' })
    );
    act(() => { vi.advanceTimersByTime(200); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups.find((g) => g.type === 'status')).toBeUndefined();
  });

  it('maps server author group and computes matchStart/matchLength', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      makeResponse([{ type: 'author', items: [{ label: 'N.K. Jemisin', value: 'N.K. Jemisin' }] }])
    );
    const { result } = renderHook(() => useSearchSuggestions('jemi', emptyFilter));
    act(() => { vi.advanceTimersByTime(200); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const authorGroup = result.current.groups.find((g) => g.type === 'author');
    expect(authorGroup?.items[0].matchStart).toBe(5); // 'jemi' in 'n.k. jemisin' at index 5
    expect(authorGroup?.items[0].matchLength).toBe(4);
    expect(authorGroup?.items[0].additive).toBe(false);
  });

  it('marks subject items as additive=true', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      makeResponse([{ type: 'subject', items: [{ label: 'Fantasy', value: 'Fantasy' }] }])
    );
    const { result } = renderHook(() => useSearchSuggestions('fan', emptyFilter));
    act(() => { vi.advanceTimersByTime(200); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const subjectGroup = result.current.groups.find((g) => g.type === 'subject');
    expect(subjectGroup?.items[0].additive).toBe(true);
  });

  it('sends active filter chips as query params', async () => {
    vi.mocked(apiFetch).mockResolvedValue(makeResponse([]));
    const { result } = renderHook(() =>
      useSearchSuggestions('fan', { author: 'N.K. Jemisin', subjects: ['Fantasy'] })
    );
    act(() => { vi.advanceTimersByTime(200); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const url = vi.mocked(apiFetch).mock.calls[0][0] as string;
    expect(url).toContain('q=fan');
    expect(url).toContain('author=N.K.+Jemisin');
    expect(url).toContain('subjects=Fantasy');
  });

  it('resets groups to [] when inputValue becomes empty', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      makeResponse([{ type: 'author', items: [{ label: 'N.K. Jemisin', value: 'N.K. Jemisin' }] }])
    );
    const { result, rerender } = renderHook(
      ({ input }: { input: string }) => useSearchSuggestions(input, emptyFilter),
      { initialProps: { input: 'jemi' } }
    );
    act(() => { vi.advanceTimersByTime(200); });
    await waitFor(() => expect(result.current.groups.length).toBeGreaterThan(0));

    rerender({ input: '' });
    expect(result.current.groups).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test file to confirm all tests fail**

```bash
cd /Users/korzun/Code/HASS-ODPS/app/client && npx vitest run src/component/search-bar/use-search-suggestions.test.ts 2>&1 | tail -20
```

Expected: multiple FAIL — the hook doesn't yet return `{ groups, loading }`

- [ ] **Step 3: Rewrite `app/client/src/component/search-bar/use-search-suggestions.ts`**

Replace the entire file:

```ts
import { useEffect, useRef, useState } from 'react';

import { apiFetch } from '~/lib/api-fetch';
import type { BookListFilter } from '~/provider/book';
import { useWithTargetUser } from '~/provider/library-target';

export type Suggestion = {
  type: 'status' | 'author' | 'series' | 'book' | 'subject';
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

type ServerItem = { label: string; value: string };
type ServerGroup = {
  type: 'author' | 'series' | 'book' | 'subject';
  items: ServerItem[];
};

const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'Not Started', value: 'not-started' },
  { label: 'In Progress', value: 'in-progress' },
  { label: 'Completed', value: 'completed' },
];

const GROUP_LABEL: Record<Suggestion['type'], string> = {
  status: 'Status',
  author: 'Author',
  series: 'Series',
  book: 'Book',
  subject: 'Subject',
};

function matchInfo(
  text: string,
  query: string
): { matchStart: number; matchLength: number } | null {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  return { matchStart: idx, matchLength: query.length };
}

export function useSearchSuggestions(
  inputValue: string,
  filter: BookListFilter
): { groups: SuggestionGroup[]; loading: boolean } {
  const withTargetUser = useWithTargetUser();
  const [groups, setGroups] = useState<SuggestionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = inputValue.trim();
    if (!query) {
      abortRef.current?.abort();
      setGroups([]);
      setLoading(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const params = new URLSearchParams({ q: query });
      if (filter.author) params.set('author', filter.author);
      if (filter.seriesName) params.set('seriesName', filter.seriesName);
      for (const s of filter.subjects ?? []) params.append('subjects', s);
      const url = withTargetUser(`/api/search/suggestions?${params.toString()}`);

      setLoading(true);
      apiFetch(url, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error('Suggestion fetch failed');
          return res.json() as Promise<{ groups: ServerGroup[] }>;
        })
        .then(({ groups: serverGroups }) => {
          if (controller.signal.aborted) return;

          const result: SuggestionGroup[] = [];

          if (!filter.status) {
            const items: Suggestion[] = [];
            for (const opt of STATUS_OPTIONS) {
              const info = matchInfo(opt.label, query);
              if (info)
                items.push({ type: 'status', label: opt.label, value: opt.value, additive: false, ...info });
            }
            if (items.length > 0) result.push({ type: 'status', label: GROUP_LABEL.status, items });
          }

          for (const g of serverGroups) {
            const additive = g.type === 'subject';
            const items: Suggestion[] = [];
            for (const item of g.items) {
              const info = matchInfo(item.label, query);
              if (!info) continue;
              items.push({ type: g.type, label: item.label, value: item.value, additive, ...info });
            }
            if (items.length > 0)
              result.push({ type: g.type, label: GROUP_LABEL[g.type], items });
          }

          setGroups(result);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setGroups([]);
          setLoading(false);
        });
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, filter, withTargetUser]);

  return { groups, loading };
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/korzun/Code/HASS-ODPS/app/client && npx vitest run src/component/search-bar/use-search-suggestions.test.ts 2>&1 | tail -10
```

Expected: all tests in this file PASS

- [ ] **Step 5: Run full client test suite**

```bash
cd /Users/korzun/Code/HASS-ODPS && npm test 2>&1 | grep -E "Tests:|FAIL" | head -5
```

Expected: all tests pass

- [ ] **Step 6: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS && npm run lint 2>&1 | tail -3
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add app/client/src/component/search-bar/use-search-suggestions.ts \
        app/client/src/component/search-bar/use-search-suggestions.test.ts
git commit -m "feat: rewrite useSearchSuggestions as debounced fetch hook"
```

---

## Task 4: Update `SearchBar` — consume `loading`, add spinner

**Files:**
- Modify: `app/client/src/component/search-bar/index.tsx`
- Modify: `app/client/src/component/search-bar/style.ts`

- [ ] **Step 1: Add spinner styles to `app/client/src/component/search-bar/style.ts`**

Find the `dropdown` style rule (around line 114). Add two new rules immediately before it:

```ts
  '@keyframes spin': {
    from: { transform: 'rotate(0deg)' },
    to: { transform: 'rotate(360deg)' },
  },
  dropdownLoading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: `${theme.space.xxl} 0`,
  },
  dropdownSpinner: {
    width: 16,
    height: 16,
    border: `2px solid ${theme.color.border.default}`,
    borderTopColor: theme.color.text.faint,
    borderRadius: '50%',
    animation: '$spin 0.6s linear infinite',
  },
```

- [ ] **Step 2: Update `app/client/src/component/search-bar/index.tsx`**

Find this line (around line 95):
```ts
  const suggestions = useSearchSuggestions(inputValue, filter);
  const flatSuggestions: Suggestion[] = suggestions.flatMap((g: SuggestionGroup) => g.items);
```

Replace with:
```ts
  const { groups, loading: suggestionsLoading } = useSearchSuggestions(inputValue, filter);
  const flatSuggestions: Suggestion[] = groups.flatMap((g: SuggestionGroup) => g.items);
```

- [ ] **Step 3: Update the dropdown render in `index.tsx`**

Find this block (around line 185):
```tsx
      {isOpen && flatSuggestions.length > 0 && (
        <div className={style.dropdown} role="listbox">
          {suggestions.map((group) => (
```

Replace with:
```tsx
      {isOpen && suggestionsLoading && (
        <div className={style.dropdown}>
          <div className={style.dropdownLoading}>
            <div
              className={style.dropdownSpinner}
              role="status"
              aria-label="Searching"
            />
          </div>
        </div>
      )}
      {isOpen && !suggestionsLoading && flatSuggestions.length > 0 && (
        <div className={style.dropdown} role="listbox">
          {groups.map((group) => (
```

- [ ] **Step 4: Run the full test suite**

```bash
cd /Users/korzun/Code/HASS-ODPS && npm test 2>&1 | grep -E "Tests:|FAIL" | head -5
```

Expected: all tests pass

- [ ] **Step 5: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS && npm run lint 2>&1 | tail -3
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add app/client/src/component/search-bar/index.tsx \
        app/client/src/component/search-bar/style.ts
git commit -m "feat: add loading spinner to search bar dropdown"
```

---

## Task 5: Cleanup — delete old hooks, routes, store methods; revert subjects

**Files:**
- Delete: `app/client/src/provider/book/hook/use-all-authors.ts`
- Delete: `app/client/src/provider/book/hook/use-all-series-names.ts`
- Delete: `app/client/src/provider/book/hook/use-all-book-titles.ts`
- Modify: `app/client/src/provider/book/hook/use-library-subjects.ts`
- Modify: `app/client/src/provider/book/hook/index.ts`
- Modify: `app/client/src/provider/book/index.ts`
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/routes/ui.ts`

- [ ] **Step 1: Delete the three client hook files**

```bash
rm app/client/src/provider/book/hook/use-all-authors.ts \
   app/client/src/provider/book/hook/use-all-series-names.ts \
   app/client/src/provider/book/hook/use-all-book-titles.ts
```

- [ ] **Step 2: Remove their exports from `app/client/src/provider/book/hook/index.ts`**

The file currently has these lines near the top:
```ts
export { useAllAuthors } from './use-all-authors';
export { useAllBookTitles } from './use-all-book-titles';
export type { BookTitleEntry } from './use-all-book-titles';
export { useAllSeriesNames } from './use-all-series-names';
```

Delete all four of those lines.

- [ ] **Step 3: Remove their exports from `app/client/src/provider/book/index.ts`**

Find and remove these lines:
```ts
  useAllAuthors,
  useAllBookTitles,
  useAllSeriesNames,
```
from the `export {` block, and remove:
```ts
export type { BookTitleEntry, SeriesMeta } from './hook';
```
replacing it with:
```ts
export type { SeriesMeta } from './hook';
```

- [ ] **Step 4: Revert `app/client/src/provider/book/hook/use-library-subjects.ts`**

The current file accepts an optional `filters?` param and builds a URL with filter params. Remove that entirely, reverting to the original simple form:

```ts
import { useEffect, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';

type Result = { url: string; subjects: string[] } | { url: string; error: string };

export const useLibrarySubjects = (): [string[], boolean, string | undefined] => {
  const [result, setResult] = useState<Result | null>(null);
  const withTargetUser = useWithTargetUser();
  const url = withTargetUser('/api/subjects');

  useEffect(() => {
    let cancelled = false;

    apiFetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch subjects');
        return res.json() as Promise<{ subjects: string[] }>;
      })
      .then((data) => {
        if (!cancelled) setResult({ url, subjects: data.subjects });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setResult({ url, error: err instanceof Error ? err.message : 'Unknown error' });
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (result === null || result.url !== url) return [[], true, undefined];
  if ('error' in result) return [[], false, result.error];
  return [result.subjects, false, undefined];
};
```

- [ ] **Step 5: Remove `listAuthors`, `listSeriesNames`, `listBookTitles` from `app/server/services/book-store.ts`**

Delete the three complete method bodies: `listAuthors` (lines ~120–141), `listSeriesNames` (lines ~143–164), `listBookTitles` (lines ~166–193).

- [ ] **Step 6: Revert `getSubjects` in `app/server/services/book-store.ts` to no-filter form**

Replace the current `getSubjects` implementation (which has optional `filters?` param) with:

```ts
async getSubjects(owner: Owner): Promise<string[]> {
  const rows = await this.prisma.$queryRaw<Array<{ value: string }>>`
    SELECT DISTINCT trim(CAST(json_each.value AS TEXT)) AS value
    FROM books, json_each(books.subjects)
    WHERE user_id = ${owner.userId}
      AND json_each.type = 'text'
      AND trim(CAST(json_each.value AS TEXT)) <> ''
    ORDER BY value
  `;
  return rows.map((r) => r.value);
}
```

- [ ] **Step 7: Remove the three old routes from `app/server/routes/ui.ts` and revert `/api/subjects`**

**Delete** the `GET /api/authors` handler (the block starting `router.get('/api/authors', ...)`).

**Delete** the `GET /api/series-names` handler.

**Delete** the `GET /api/books/titles` handler.

**Revert** `GET /api/subjects` to its original no-filter form:

```ts
  router.get('/api/subjects', requireAuth, async (req: Request, res: Response) => {
    const owner = await resolveOwner(req, res);
    if (!owner) return;
    const subjects = await bookStore.getSubjects(owner);
    res.json({ subjects });
  });
```

- [ ] **Step 8: Run full test suite**

```bash
cd /Users/korzun/Code/HASS-ODPS && npm test 2>&1 | grep -E "Tests:|FAIL" | head -5
```

Expected: all tests pass

- [ ] **Step 9: Run lint**

```bash
cd /Users/korzun/Code/HASS-ODPS && npm run lint 2>&1 | tail -3
```

Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: remove old suggestion hooks, routes, and store methods; revert subjects to no-filter form"
```

# Fuzzy Search Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SearchBar type-ahead surface results for initials abbreviations ("NK J" → "N.K. Jemisin") and character-omission typos ("Texcalaan" → "Teixcalaan").

**Architecture:** The server generates a character-subsequence LIKE pattern from the normalised query, fetches up to 30 candidates per type, scores and sorts them in Node.js, then returns top-5 results with pre-computed highlight positions. The client removes its existing substring-only filter and renders the server-provided `matchStart`/`matchLength` directly.

**Tech Stack:** Node.js/TypeScript, Prisma `$queryRaw` (SQLite), React/TypeScript, Jest (server), Vitest (client)

---

## File Map

| File | Change |
|---|---|
| `app/server/utils/fuzzy-search.ts` | **Create** — `normalizeForSearch`, `toSubsequenceLike`, `fuzzyScore`, `computeMatchWindow`, `scoreAndRank` |
| `app/server/utils/fuzzy-search.test.ts` | **Create** — unit tests for all helpers |
| `app/server/types.ts` | **Modify** — add `matchStart`, `matchLength` to `SearchSuggestionsResponse` item type |
| `app/server/services/book-store.ts` | **Modify** — rewrite `getSearchSuggestions` to use subsequence LIKE + Node scoring |
| `app/server/services/book-store.test.ts` | **Modify** — update assertions to include `matchStart`/`matchLength`; add fuzzy tests |
| `app/client/src/component/search-bar/use-search-suggestions.ts` | **Modify** — remove client-side substring filter; use server match positions |
| `app/client/src/component/search-bar/use-search-suggestions.test.ts` | **Modify** — update mock data; add pass-through test |

---

## Task 1: Fuzzy search helper functions

**Files:**
- Create: `app/server/utils/fuzzy-search.ts`
- Create: `app/server/utils/fuzzy-search.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/server/utils/fuzzy-search.test.ts`:

```typescript
import {
  normalizeForSearch,
  toSubsequenceLike,
  fuzzyScore,
  computeMatchWindow,
  scoreAndRank,
} from './fuzzy-search';

describe('normalizeForSearch', () => {
  it('lowercases and strips non-alphanumeric characters', () => {
    expect(normalizeForSearch('N. K. Jemisin')).toBe('nkjemisin');
  });

  it('strips punctuation from series names', () => {
    expect(normalizeForSearch('Teixcalaan')).toBe('teixcalaan');
  });

  it('handles empty string', () => {
    expect(normalizeForSearch('')).toBe('');
  });
});

describe('toSubsequenceLike', () => {
  it('inserts % between every character and at start/end', () => {
    expect(toSubsequenceLike('nkj')).toBe('%n%k%j%');
  });

  it('handles single character', () => {
    expect(toSubsequenceLike('a')).toBe('%a%');
  });

  it('returns bare % for empty string', () => {
    expect(toSubsequenceLike('')).toBe('%');
  });
});

describe('fuzzyScore', () => {
  it('returns 1.0 when normalised query is a substring of normalised candidate', () => {
    // "nkjemisin" contains "nkj" → exact normalised substring
    expect(fuzzyScore('nkj', 'nkjemisin')).toBe(1.0);
  });

  it('returns 1.0 for direct substring match', () => {
    expect(fuzzyScore('jemi', 'nkjemisin')).toBe(1.0);
  });

  it('returns a score between 0.4 and 1.0 for a near-miss typo (omitted char)', () => {
    // "texcalaan" is a subsequence of "teixcalaan" with tightness 9/10 → 0.85
    const score = fuzzyScore('texcalaan', 'teixcalaan');
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(1.0);
  });

  it('returns 0 when query chars are not a subsequence of the candidate', () => {
    expect(fuzzyScore('zzz', 'nkjemisin')).toBe(0);
  });

  it('returns 0 for empty query', () => {
    expect(fuzzyScore('', 'nkjemisin')).toBe(0);
  });

  it('scores tighter windows higher than sparse ones', () => {
    // "abc" in "abcxyz" is tight; "abc" in "axbxcxxx" is sparse
    const tightScore = fuzzyScore('abc', 'abcxyz');
    const sparseScore = fuzzyScore('abc', 'axbxcxxx');
    expect(tightScore).toBeGreaterThan(sparseScore);
  });
});

describe('computeMatchWindow', () => {
  it('finds exact substring in original label (case-insensitive)', () => {
    // "jemi" found contiguously starting at position 5 in "N.K. Jemisin"
    expect(computeMatchWindow('jemi', 'N.K. Jemisin')).toEqual({ matchStart: 5, matchLength: 4 });
  });

  it('spans from first to last matched char for initials query', () => {
    // "nkj" → N at 0, K at 2, J at 5 → span 0–5 = length 6
    expect(computeMatchWindow('nkj', 'N.K. Jemisin')).toEqual({ matchStart: 0, matchLength: 6 });
  });

  it('spans the whole word for a single-char-omission typo', () => {
    // query "texcalaan", label "Teixcalaan" — all chars found in order 0→9
    expect(computeMatchWindow('texcalaan', 'Teixcalaan')).toEqual({
      matchStart: 0,
      matchLength: 10,
    });
  });

  it('returns zero-length window when query chars are not found', () => {
    expect(computeMatchWindow('zzz', 'Jemisin')).toEqual({ matchStart: 0, matchLength: 0 });
  });
});

describe('scoreAndRank', () => {
  const items = [
    { label: 'Teixcalaan', value: 'Teixcalaan' },
    { label: 'N.K. Jemisin', value: 'N.K. Jemisin' },
    { label: 'Piranesi', value: 'Piranesi' },
  ];

  it('returns items matching the normalised query, sorted by score descending', () => {
    // "nkj" is exact normalised substring of "nkjemisin" (score 1.0)
    const result = scoreAndRank(items, 'nkj');
    expect(result.map((i) => i.value)).toContain('N.K. Jemisin');
    expect(result.map((i) => i.value)).not.toContain('Piranesi');
  });

  it('caps results at the specified limit', () => {
    const manyItems = Array.from({ length: 10 }, (_, i) => ({
      label: `Alpha Item ${i}`,
      value: `alpha-${i}`,
    }));
    expect(scoreAndRank(manyItems, 'alpha', 5).length).toBeLessThanOrEqual(5);
  });

  it('drops items that score 0', () => {
    const result = scoreAndRank(items, 'zzz');
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /path/to/HASS-ODPS/app/server
npx jest --testPathPattern=fuzzy-search
```

Expected: all tests fail with "Cannot find module './fuzzy-search'"

- [ ] **Step 3: Implement the helpers**

Create `app/server/utils/fuzzy-search.ts`:

```typescript
export function normalizeForSearch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function toSubsequenceLike(normalized: string): string {
  if (!normalized) return '%';
  return '%' + normalized.split('').join('%') + '%';
}

export function fuzzyScore(normalizedQuery: string, normalizedCandidate: string): number {
  if (!normalizedQuery) return 0;
  if (normalizedCandidate.includes(normalizedQuery)) return 1.0;

  let qi = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  for (let ci = 0; ci < normalizedCandidate.length && qi < normalizedQuery.length; ci++) {
    if (normalizedCandidate[ci] === normalizedQuery[qi]) {
      if (firstMatch === -1) firstMatch = ci;
      lastMatch = ci;
      qi++;
    }
  }
  if (qi < normalizedQuery.length) return 0;

  const windowLength = lastMatch - firstMatch + 1;
  const tightness = normalizedQuery.length / windowLength;
  return 0.4 + tightness * 0.5;
}

export function computeMatchWindow(
  query: string,
  label: string
): { matchStart: number; matchLength: number } {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return { matchStart: 0, matchLength: 0 };

  let qi = 0;
  let firstPos = -1;
  let lastPos = -1;
  for (let i = 0; i < label.length && qi < normalizedQuery.length; i++) {
    const ch = label[i].toLowerCase();
    if (/[a-z0-9]/.test(ch) && ch === normalizedQuery[qi]) {
      if (firstPos === -1) firstPos = i;
      lastPos = i;
      qi++;
    }
  }
  if (qi < normalizedQuery.length || firstPos === -1) return { matchStart: 0, matchLength: 0 };
  return { matchStart: firstPos, matchLength: lastPos - firstPos + 1 };
}

export function scoreAndRank(
  items: Array<{ label: string; value: string }>,
  normalizedQuery: string,
  limit = 5
): Array<{ label: string; value: string }> {
  return items
    .map((item) => ({ item, score: fuzzyScore(normalizedQuery, normalizeForSearch(item.label)) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => item);
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd /path/to/HASS-ODPS/app/server
npx jest --testPathPattern=fuzzy-search
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add app/server/utils/fuzzy-search.ts app/server/utils/fuzzy-search.test.ts
git commit -m "feat: add fuzzy search helper functions (normalize, score, match window)"
```

---

## Task 2: Extend the server suggestion response type

**Files:**
- Modify: `app/server/types.ts:94-99`

- [ ] **Step 1: Update `SearchSuggestionsResponse` in `app/server/types.ts`**

Replace the current item type:

```typescript
// Before
export type SearchSuggestionsResponse = {
  groups: Array<{
    type: 'author' | 'series' | 'book' | 'subject';
    items: Array<{ label: string; value: string }>;
  }>;
};
```

With:

```typescript
// After
export type SearchSuggestionsResponse = {
  groups: Array<{
    type: 'author' | 'series' | 'book' | 'subject';
    items: Array<{ label: string; value: string; matchStart: number; matchLength: number }>;
  }>;
};
```

- [ ] **Step 2: Verify the build still compiles**

```bash
cd /path/to/HASS-ODPS/app/server
npx tsc --noEmit
```

Expected: TypeScript errors pointing to `book-store.ts` (items no longer satisfy the new type) — these will be fixed in Task 3. If there are errors elsewhere, fix them before continuing.

- [ ] **Step 3: Commit**

```bash
git add app/server/types.ts
git commit -m "feat: add matchStart/matchLength to SearchSuggestionsResponse item type"
```

---

## Task 3: Rewrite `getSearchSuggestions` with fuzzy matching

**Files:**
- Modify: `app/server/services/book-store.ts:1-18` (imports) and `book-store.ts:133-222` (method body)
- Modify: `app/server/services/book-store.test.ts:2098-2257`

- [ ] **Step 1: Add the fuzzy-search import to `book-store.ts`**

At the top of `app/server/services/book-store.ts`, after the existing imports, add:

```typescript
import { normalizeForSearch, toSubsequenceLike, computeMatchWindow, scoreAndRank } from '../utils/fuzzy-search';
```

- [ ] **Step 2: Write the new failing fuzzy tests in `book-store.test.ts`**

Add these two tests inside the existing `describe('getSearchSuggestions', ...)` block, before the closing `});`:

```typescript
it('returns author matching initials abbreviation (NK J → N.K. Jemisin)', async () => {
  await bookStore.addBook(OWNER, 'b1', stage('b1'), {
    ...FAKE_META,
    title: 'The Fifth Season',
    author: 'N.K. Jemisin',
    series: '',
    seriesIndex: 0,
    subjects: [],
  });
  const result = await bookStore.getSearchSuggestions(OWNER, { q: 'NK J', filter: {} });
  const authors = result.groups.find((g) => g.type === 'author');
  expect(authors?.items.map((i) => i.value)).toContain('N.K. Jemisin');
});

it('returns series matching single-char omission typo (Texcalaan → Teixcalaan)', async () => {
  await bookStore.addBook(OWNER, 'b1', stage('b1'), {
    ...FAKE_META,
    title: 'A Memory Called Empire',
    author: 'Arkady Martine',
    series: 'Teixcalaan',
    seriesIndex: 1,
    subjects: [],
  });
  const result = await bookStore.getSearchSuggestions(OWNER, { q: 'Texcalaan', filter: {} });
  const series = result.groups.find((g) => g.type === 'series');
  expect(series?.items.map((i) => i.value)).toContain('Teixcalaan');
});
```

- [ ] **Step 3: Run the tests to confirm the new ones fail**

```bash
cd /path/to/HASS-ODPS/app/server
npx jest --testPathPattern=book-store --testNamePattern="initials|omission"
```

Expected: 2 tests fail

- [ ] **Step 4: Replace the `getSearchSuggestions` method body in `book-store.ts`**

Replace the entire method (lines 133–222) with:

```typescript
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
  const normalizedQ = normalizeForSearch(q);
  const likePat = toSubsequenceLike(normalizedQ);
  const groups: SearchSuggestionsResponse['groups'] = [];

  if (!filter.author) {
    const rows = await this.prisma.$queryRaw<Array<{ value: string }>>`
      SELECT DISTINCT author AS value
      FROM books
      WHERE user_id = ${owner.userId}
        AND author LIKE ${likePat}
        ${filter.seriesName ? Prisma.sql`AND series = ${filter.seriesName}` : Prisma.empty}
      ORDER BY author
      LIMIT 30
    `;
    const ranked = scoreAndRank(
      rows.map((r) => ({ label: r.value, value: r.value })),
      normalizedQ
    );
    if (ranked.length > 0)
      groups.push({
        type: 'author',
        items: ranked.map(({ label, value }) => ({
          label,
          value,
          ...computeMatchWindow(q, label),
        })),
      });
  }

  if (!filter.seriesName) {
    const rows = await this.prisma.$queryRaw<Array<{ value: string }>>`
      SELECT s.name AS value
      FROM series s
      WHERE s.user_id = ${owner.userId}
        AND s.name LIKE ${likePat}
        ${
          filter.author
            ? Prisma.sql`AND EXISTS (
                SELECT 1 FROM books b
                WHERE b.series_id = s.id AND b.author = ${filter.author}
              )`
            : Prisma.empty
        }
      ORDER BY s.name
      LIMIT 30
    `;
    const ranked = scoreAndRank(
      rows.map((r) => ({ label: r.value, value: r.value })),
      normalizedQ
    );
    if (ranked.length > 0)
      groups.push({
        type: 'series',
        items: ranked.map(({ label, value }) => ({
          label,
          value,
          ...computeMatchWindow(q, label),
        })),
      });
  }

  const [bookRows, subjectRows] = await Promise.all([
    this.prisma.$queryRaw<Array<{ id: string; title: string }>>`
      SELECT id, title
      FROM books
      WHERE user_id = ${owner.userId}
        AND title LIKE ${likePat}
        ${filter.author ? Prisma.sql`AND author = ${filter.author}` : Prisma.empty}
        ${filter.seriesName ? Prisma.sql`AND series = ${filter.seriesName}` : Prisma.empty}
      ORDER BY title
      LIMIT 30
    `,
    this.prisma.$queryRaw<Array<{ value: string }>>`
      SELECT DISTINCT trim(CAST(json_each.value AS TEXT)) AS value
      FROM books, json_each(books.subjects)
      WHERE user_id = ${owner.userId}
        AND LOWER(trim(CAST(json_each.value AS TEXT))) LIKE LOWER(${likePat})
        ${filter.author ? Prisma.sql`AND author = ${filter.author}` : Prisma.empty}
        ${filter.seriesName ? Prisma.sql`AND series = ${filter.seriesName}` : Prisma.empty}
        AND json_each.type = 'text'
        AND trim(CAST(json_each.value AS TEXT)) <> ''
      ORDER BY value
      LIMIT 30
    `,
  ]);

  const rankedBooks = scoreAndRank(
    bookRows.map((r) => ({ label: r.title, value: r.id })),
    normalizedQ
  );
  if (rankedBooks.length > 0)
    groups.push({
      type: 'book',
      items: rankedBooks.map(({ label, value }) => ({
        label,
        value,
        ...computeMatchWindow(q, label),
      })),
    });

  const activeSubjectSet = new Set(filter.activeSubjects ?? []);
  const rankedSubjects = scoreAndRank(
    subjectRows
      .filter((r) => !activeSubjectSet.has(r.value))
      .map((r) => ({ label: r.value, value: r.value })),
    normalizedQ
  );
  if (rankedSubjects.length > 0)
    groups.push({
      type: 'subject',
      items: rankedSubjects.map(({ label, value }) => ({
        label,
        value,
        ...computeMatchWindow(q, label),
      })),
    });

  return { groups };
}
```

- [ ] **Step 5: Update the existing `getSearchSuggestions` test assertions**

The existing tests use `.toEqual` on items, which will now fail because items have `matchStart` and `matchLength`. Update the four affected assertions.

**Computed values** (apply `computeMatchWindow(query, label)` mentally):

| query | label | matchStart | matchLength | reasoning |
|---|---|---|---|---|
| `'jemi'` | `'N.K. Jemisin'` | 5 | 4 | J at 5, i at 8 → span 5–8 |
| `'broken'` | `'Broken Earth'` | 0 | 6 | B at 0, n at 5 → span 0–5 |
| `'fifth'` | `'The Fifth Season'` | 4 | 5 | F at 4, h at 8 → span 4–8 |
| `'fan'` | `'Fantasy'` | 0 | 3 | F at 0, n at 2 → span 0–2 |

In `app/server/services/book-store.test.ts`, make these replacements:

```typescript
// Test: 'returns matching authors'
// Before:
expect(authors?.items).toEqual([{ label: 'N.K. Jemisin', value: 'N.K. Jemisin' }]);
// After:
expect(authors?.items).toEqual([
  { label: 'N.K. Jemisin', value: 'N.K. Jemisin', matchStart: 5, matchLength: 4 },
]);

// Test: 'returns matching series'
// Before:
expect(series?.items).toEqual([{ label: 'Broken Earth', value: 'Broken Earth' }]);
// After:
expect(series?.items).toEqual([
  { label: 'Broken Earth', value: 'Broken Earth', matchStart: 0, matchLength: 6 },
]);

// Test: 'returns matching book titles'
// Before:
expect(books?.items).toEqual([{ label: 'The Fifth Season', value: 'b1' }]);
// After:
expect(books?.items).toEqual([
  { label: 'The Fifth Season', value: 'b1', matchStart: 4, matchLength: 5 },
]);

// Test: 'returns matching subjects'
// Before:
expect(subjects?.items).toEqual([{ label: 'Fantasy', value: 'Fantasy' }]);
// After:
expect(subjects?.items).toEqual([
  { label: 'Fantasy', value: 'Fantasy', matchStart: 0, matchLength: 3 },
]);
```

- [ ] **Step 6: Run all `getSearchSuggestions` tests**

```bash
cd /path/to/HASS-ODPS/app/server
npx jest --testPathPattern=book-store --testNamePattern="getSearchSuggestions"
```

Expected: all tests pass (including the two new fuzzy tests)

- [ ] **Step 7: Run the full server test suite**

```bash
cd /path/to/HASS-ODPS/app/server
npx jest
```

Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: rewrite getSearchSuggestions with fuzzy subsequence matching"
```

---

## Task 4: Update the client hook to use server-provided match positions

**Files:**
- Modify: `app/client/src/component/search-bar/use-search-suggestions.ts:22-26` (ServerItem type) and lines `123-134` (server groups loop)
- Modify: `app/client/src/component/search-bar/use-search-suggestions.test.ts`

- [ ] **Step 1: Write the new failing client test**

In `app/client/src/component/search-bar/use-search-suggestions.test.ts`, add after the last `it(...)` block:

```typescript
it('passes through server match positions without filtering by substring', async () => {
  vi.mocked(apiFetch).mockResolvedValue(
    makeResponse([
      {
        type: 'author',
        items: [
          { label: 'N.K. Jemisin', value: 'N.K. Jemisin', matchStart: 0, matchLength: 6 },
        ],
      },
    ])
  );
  const { result } = renderHook(() => useSearchSuggestions('nk j', emptyFilter));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  const authorGroup = result.current.groups.find((g) => g.type === 'author');
  expect(authorGroup?.items).toHaveLength(1);
  expect(authorGroup?.items[0].matchStart).toBe(0);
  expect(authorGroup?.items[0].matchLength).toBe(6);
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd /path/to/HASS-ODPS/app/client
npx vitest run src/component/search-bar/use-search-suggestions.test.ts
```

Expected: the new test fails (server item is filtered out because `matchInfo('N.K. Jemisin', 'nk j')` returns null)

- [ ] **Step 3: Update `ServerItem` type and remove the substring filter**

In `app/client/src/component/search-bar/use-search-suggestions.ts`, make two changes:

**Change 1** — update the `ServerItem` type (around line 22):

```typescript
// Before:
type ServerItem = { label: string; value: string };

// After:
type ServerItem = { label: string; value: string; matchStart: number; matchLength: number };
```

**Change 2** — update the server groups loop (around lines 123–134). Replace:

```typescript
for (const g of serverGroups) {
  const additive = g.type === 'subject';
  const items: Suggestion[] = [];
  for (const item of g.items) {
    const info = matchInfo(item.label, query);
    if (!info) continue;
    items.push({ type: g.type, label: item.label, value: item.value, additive, ...info });
  }
  if (items.length > 0) {
    result.push({ type: g.type, label: GROUP_LABEL[g.type], items });
  }
}
```

With:

```typescript
for (const g of serverGroups) {
  const additive = g.type === 'subject';
  const items: Suggestion[] = g.items.map((item) => ({
    type: g.type,
    label: item.label,
    value: item.value,
    additive,
    matchStart: item.matchStart,
    matchLength: item.matchLength,
  }));
  if (items.length > 0) {
    result.push({ type: g.type, label: GROUP_LABEL[g.type], items });
  }
}
```

- [ ] **Step 4: Update the existing mock data in the test file to include match positions**

Tests that pass mock items to `makeResponse` need `matchStart` and `matchLength`. Update each mock item:

```typescript
// 'maps server author group and computes matchStart/matchLength' test
// Before:
makeResponse([{ type: 'author', items: [{ label: 'N.K. Jemisin', value: 'N.K. Jemisin' }] }])
// After:
makeResponse([{ type: 'author', items: [{ label: 'N.K. Jemisin', value: 'N.K. Jemisin', matchStart: 5, matchLength: 4 }] }])

// 'marks subject items as additive=true' test
// Before:
makeResponse([{ type: 'subject', items: [{ label: 'Fantasy', value: 'Fantasy' }] }])
// After:
makeResponse([{ type: 'subject', items: [{ label: 'Fantasy', value: 'Fantasy', matchStart: 0, matchLength: 3 }] }])

// 'sends active filter chips as query params' test — makeResponse([]) has no items, no change needed

// 'resets groups to [] when inputValue becomes empty' test
// Before:
makeResponse([{ type: 'author', items: [{ label: 'N.K. Jemisin', value: 'N.K. Jemisin' }] }])
// After:
makeResponse([{ type: 'author', items: [{ label: 'N.K. Jemisin', value: 'N.K. Jemisin', matchStart: 5, matchLength: 4 }] }])
```

Also update the assertion in 'maps server author group and computes matchStart/matchLength' — this test currently checks that the client COMPUTES `matchStart`/`matchLength`. It still applies but now verifies the value comes from the server:

```typescript
// The assertion stays the same (5 and 4), but the comment changes:
expect(authorGroup?.items[0].matchStart).toBe(5); // provided by server
expect(authorGroup?.items[0].matchLength).toBe(4);
```

- [ ] **Step 5: Run all client search-bar tests**

```bash
cd /path/to/HASS-ODPS/app/client
npx vitest run src/component/search-bar/use-search-suggestions.test.ts
```

Expected: all 12 tests pass

- [ ] **Step 6: Run the full client test suite**

```bash
cd /path/to/HASS-ODPS/app/client
npx vitest run
```

Expected: all tests pass

- [ ] **Step 7: Run the client linter**

```bash
cd /path/to/HASS-ODPS/app/client
npm run lint
```

Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add app/client/src/component/search-bar/use-search-suggestions.ts \
        app/client/src/component/search-bar/use-search-suggestions.test.ts
git commit -m "feat: use server-provided match positions in search suggestions"
```

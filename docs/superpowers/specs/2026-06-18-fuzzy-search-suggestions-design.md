# Fuzzy Search Suggestions Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve SearchBar type-ahead so that initials abbreviations (e.g. "NK J" → "N. K. Jemisin") and character-omission typos (e.g. "Texcalaan" → "Teixcalaan") surface the correct suggestions.

**Architecture:** The server pre-filters using a character-subsequence LIKE pattern (wildcards between every normalised query character), fetches up to 30 candidates per type, scores and sorts them in Node.js, and returns the top 5 with pre-computed highlight positions. The client removes its existing substring-only match filter and renders server-provided match positions directly.

**Tech Stack:** Node.js/TypeScript (server scoring), Prisma `$queryRaw` (SQLite), React/TypeScript (client rendering)

---

## Approach

### Why character-subsequence pre-filter

Normalising the query (lowercase, strip non-alphanumeric) and inserting `%` between every character produces a LIKE pattern that acts as a "character subsequence" filter:

- `"NK J"` → normalised `"nkj"` → LIKE `%n%k%j%` → matches `"N. K. Jemisin"` (normalised `"nkjemisin"` contains `"nkj"` as a substring, and the raw value contains n, k, j in order)
- `"Texcalaan"` → normalised `"texcalaan"` → LIKE `%t%e%x%c%a%l%a%a%n%` → matches `"Teixcalaan"` (all chars appear in order; the extra `i` is skipped)

SQLite LIKE is case-insensitive for ASCII by default, so the pattern works against the raw stored values.

**Limitation acknowledged:** Character *substitutions* (e.g. "Teixcalawn" with w→n) do not survive the subsequence filter. SQLite FTS5 trigram tables can be layered on later to address this.

---

## Server Changes

### Helper functions (in `book-store.ts`)

```ts
function normalizeForSearch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toSubsequenceLike(normalized: string): string {
  return '%' + normalized.split('').join('%') + '%';
}
```

`normalizeForSearch` is used both to build the LIKE pattern and during Node-side scoring.

### Scoring (`fuzzyScore`)

After fetching up to 30 candidates per type, each label is scored against the normalised query:

| Condition | Score |
|---|---|
| Normalised candidate contains normalised query as a substring | 1.0 |
| Subsequence match — tight window (span ≤ 2× query length) | 0.8 |
| Subsequence match — medium window | 0.6 |
| Subsequence match — sparse window | 0.4 |

Items scoring below 0.4 are dropped. The top 5 by score are returned. Ties keep the original alphabetical order from SQLite.

Tightness is measured as `queryLength / windowLength` where `windowLength` is the distance between the first and last matched character positions in the normalised candidate.

### Match window for highlighting (`computeMatchWindow`)

The server computes `matchStart` and `matchLength` over the **original display label** (not the normalised form) so the client can highlight directly:

1. Normalise the query to get individual chars.
2. Walk the label (lowercased for comparison), advancing through query chars greedily.
3. `matchStart` = position of the first matched char in the label.
4. `matchLength` = (position of last matched char + 1) − matchStart.

Example — query `"nkj"`, label `"N. K. Jemisin"`:
- `n` at 0, `k` at 3, `j` at 6 → matchStart=0, matchLength=7 → highlights `"N. K. J"`

Example — query `"texcalaan"`, label `"Teixcalaan"`:
- All chars matched in order → matchStart=0, matchLength=10 → highlights `"Teixcalaan"`

### Updated `getSearchSuggestions` query strategy

All four types switch from Prisma `{ contains: q }` to `$queryRaw` with the subsequence LIKE:

```sql
-- Author example
SELECT DISTINCT author AS value
FROM books
WHERE user_id = ? AND author LIKE ?
ORDER BY author
LIMIT 30
```

The LIKE parameter is `toSubsequenceLike(normalizeForSearch(q))`.

Subjects already use `$queryRaw`; the LIKE condition is updated in the same way.

Books query the `title` column; the value returned is the book id (unchanged).

### Updated `SearchSuggestionsResponse` type

Items gain two required fields:

```ts
type SearchSuggestionsResponse = {
  groups: Array<{
    type: 'author' | 'series' | 'book' | 'subject';
    items: Array<{
      label: string;
      value: string;
      matchStart: number;
      matchLength: number;
    }>;
  }>;
};
```

---

## Client Changes

### `use-search-suggestions.ts`

**Remove the substring filter.** Currently:

```ts
const info = matchInfo(item.label, query);
if (!info) continue; // ← drops fuzzy results — remove this
```

The `matchInfo` call and the `if (!info) continue` guard are removed for server-provided groups. The server's `matchStart` and `matchLength` are used directly.

The `matchInfo` function is still used for the **status group**, which is computed entirely client-side and remains unchanged.

**Update `ServerItem` type** to include `matchStart: number` and `matchLength: number`.

---

## Testing

### Server unit tests (`book-store.ts` or a co-located helper test)

- `normalizeForSearch` — punctuation, spaces, mixed case
- `toSubsequenceLike` — single char, multi-char, empty string guard
- `fuzzyScore` — exact substring match scores 1.0; tight subsequence scores > sparse subsequence; non-match scores 0
- `computeMatchWindow` — initials case, omission-typo case, exact match case

### Integration: `getSearchSuggestions` (existing test file or new)

- "NK J" query returns the author "N. K. Jemisin" with correct matchStart/matchLength
- "Texcalaan" query returns the series "Teixcalaan"
- Exact substring query still works and scores highest
- Items are capped at 5 per type in the response

### Client unit tests (`use-search-suggestions.test.ts`)

- Server groups with `matchStart`/`matchLength` are passed through without filtering
- Status group still uses client-side `matchInfo` (unchanged behaviour)

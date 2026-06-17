# Book Search — Design Spec

**Date:** 2026-06-16  
**Branch:** worktree-feature+book-search  
**Status:** Approved

---

## Overview

Replace the Library page's three-dropdown `FilterBar` with a single type-ahead `SearchBar`. Users type into one input; matching suggestions appear grouped by category (Status, Author, Series, Subject). Selecting a suggestion adds a chip. Free text not matched to a suggestion is treated as a title/series-name query. All active chips and query text are ANDed server-side. The `FilterBar` component is deleted.

---

## Component Architecture

### `SearchBar` (`component/search-bar/`)

Replaces `FilterBar` in `LibraryPage`. Accepts the same contract:

```ts
interface SearchBarProps {
  filter: BookListFilter;
  onChange: (filter: BookListFilter) => void;
}
```

Internally manages:
- `inputValue: string` — the text currently typed in the input
- `isOpen: boolean` — whether the suggestion dropdown is visible

Renders as Option C layout: a single rounded container with chips wrapping above an internal divider, and the text input below. The chips section (and divider) is hidden when no chips are active, so the bar looks like a standard search input when empty.

The `✕` button at the right of the input row clears all chips and the input text in one action (calls `onChange({})` and resets `inputValue`).

Pressing **Enter** with text in the input (without selecting a dropdown item) commits `inputValue` as a `query` filter and closes the dropdown.

### `use-search-suggestions` (`component/search-bar/use-search-suggestions.ts`)

Derives suggestion groups from loaded book data and the static status list. Takes the current `inputValue` and active `filter`, returns grouped suggestions:

```ts
type Suggestion = {
  type: 'status' | 'author' | 'series' | 'subject';
  label: string;
  value: string;
  matchStart: number;  // for bold highlighting
  matchLength: number;
};

type SuggestionGroup = {
  type: Suggestion['type'];
  label: string;  // "Status", "Author", "Series", "Subject"
  items: Suggestion[];
};
```

**Suggestion sources:**

| Type | Source | Exclusivity |
|------|--------|-------------|
| Status | Static: "Not Started", "In Progress", "Completed" | Exclusive — omit group if `filter.status` is set |
| Author | Unique `author` values from loaded `bookList` context | Exclusive — omit group if `filter.author` is set. Value used verbatim (exact string from book data). |
| Series | Unique `series` values from loaded `bookList` context | Exclusive — omit group if `filter.seriesName` is set. Value used verbatim. |
| Subject | `useLibrarySubjects()` result | Multi — always shown; already-selected subjects omitted from items |

Groups with zero matching items are omitted from the returned array. Groups are only included when `inputValue` is non-empty.

Each `Suggestion` also carries an `additive: boolean` flag — `true` for Subject, `false` for all exclusive types. The `SearchBar` renders a `＋` badge at the trailing edge of Subject suggestion items in the dropdown. Exclusive suggestion items have no badge. This is the primary affordance distinguishing additive from exclusive: Subject rows visually invite stacking, exclusive rows do not. Once an exclusive chip is active its entire group is omitted from suggestions, which enforces the constraint and removes ambiguity.

---

## Chip Design

Each chip type has a distinct color and a small uppercase type label:

| Type | Semantic token | Label |
|------|---------------|-------|
| Status | `theme.color.chip.status` | STATUS |
| Author | `theme.color.chip.author` | AUTHOR |
| Series | `theme.color.chip.series` | SERIES |
| Subject | `theme.color.chip.subject` | SUBJECT |

Chip colors live in the theme, not hardcoded in the component. A new `color.chip` section is added to `Theme` in `theme.ts`:

```ts
chip: {
  status:  { text: string; bg: string; border: string };
  author:  { text: string; bg: string; border: string };
  series:  { text: string; bg: string; border: string };
  subject: { text: string; bg: string; border: string };
};
```

`SearchBar`'s `style.ts` references `theme.color.chip.status.text` etc. The primitive color values (purple, green, amber) are defined inline within `buildTheme()` — no new top-level palette exports needed unless a future component reuses them.

Chips for exclusive types (Status, Author, Series) — only one chip at a time. Selecting a new one replaces the existing one. Subject chips — multiple allowed, ANDed together.

Each chip has an `✕` button that removes it from the filter.

---

## Data Model Changes

### Client — `BookListFilter` (`provider/book/type.ts`)

```ts
// Before
export type BookListFilter = {
  type?: 'standalone' | 'series';
  status?: 'not-started' | 'in-progress' | 'completed';
  subject?: string;
};

// After
export type BookListFilter = {
  query?: string;       // free-text: matches book title + series name (LIKE)
  author?: string;      // exact author chip
  seriesName?: string;  // exact series chip
  status?: 'not-started' | 'in-progress' | 'completed';
  subjects?: string[];  // multi-value subject chips
};
```

`type` is dropped. `subject` → `subjects[]`. `query`, `author`, `seriesName` are added.

### Server — `BookListFilters` (`app/server/types.ts`)

```ts
// Before
export type BookListFilters = {
  type?: 'standalone' | 'series';
  status?: 'not-started' | 'in-progress' | 'completed';
  subject?: string;
};

// After
export type BookListFilters = {
  query?: string;
  author?: string;
  seriesName?: string;
  status?: 'not-started' | 'in-progress' | 'completed';
  subjects?: string[];
};
```

---

## API Changes (`routes/ui.ts`)

`GET /api/books` gains new query params and changes one existing param:

| Param | Type | Description |
|-------|------|-------------|
| `query` | string | Free-text; LIKE on book title and series name |
| `author` | string | LIKE on book author field |
| `seriesName` | string | Exact match on series name |
| `subjects` | string[] (repeatable) | Replaces `subject`; each value ANDed |

`type` param is removed from validation. `subject` param is replaced by repeatable `subjects[]`. Existing `status` param is unchanged.

The route constructs `BookListFilters` from these params and passes to `bookStore.listBooksPage`.

---

## Server-Side Filtering (`services/book-store.ts`)

`listBooksPage` gains four new WHERE conditions. All are additive (ANDed with existing conditions):

### `query` — free-text title/series search
- Standalone books: `bookWhere = { ...bookWhere, title: { contains: query, mode: 'insensitive' } }`  
  *(SQLite LIKE is already case-insensitive for ASCII; `mode` is a Prisma hint)*
- Series: `seriesWhere = { ...seriesWhere, name: { contains: query, mode: 'insensitive' } }`

### `author` — author chip (value is the exact string from book data, sent verbatim)
- Standalone books: `bookWhere = { ...bookWhere, author: { contains: author, mode: 'insensitive' } }`
- Series: filtered to series where at least one member book has a matching author. Implemented via a raw subquery:  
  `WHERE series.id IN (SELECT seriesId FROM books WHERE user_id = ? AND author LIKE ?)`

### `seriesName` — series chip (exact match)
- Series: `seriesWhere = { ...seriesWhere, name: { equals: seriesName } }`
- Standalone books: excluded (`includeStandalones = false` when `seriesName` is set), since a series chip implies the user wants the series view + its member books, not unrelated standalones. Member books of the series appear via the existing series member fetch inside `listBooksPage`.

### `subjects[]` — multi-value subject chips
- For each subject value, applies the existing `subjects: { contains: JSON.stringify(subject) }` pattern to both `bookWhere` and `seriesWhere`, chained as AND conditions.

---

## State Management

`setBookListFilter` in `BookProvider` already resets the full list and triggers a refetch when called (clears `bookListFetched`, `bookList`, `bookListItems`, `nextCursor`). No changes needed to the provider — `SearchBar` calls `onChange` which calls `setBookListFilter`, same as `FilterBar` did.

`useFetchBookList` must be updated to send the new params: `query`, `author`, `seriesName`, `subjects[]` (appended as multiple `subjects` params), and `status`. The `type` and `subject` params are removed.

---

## Results Display

The `LibraryPage` list rendering is unchanged — it still renders `SeriesRow` and `BookRow` from `bookListItems`. The search result ordering follows the existing `listBooksPage` merge-sort: series rows sort before standalones with the same key, so a series named "Broken Earth" appears before its member books when both match.

Empty state copy changes:
- No chips/query active: "Your library is empty" (unchanged)
- Chips/query active, no results: "No books match your search" / "Try adjusting or clearing the filters above"

---

## Files Changed

**Deleted:**
- `app/client/src/component/filter-bar/index.tsx`
- `app/client/src/component/filter-bar/style.ts`

**Added:**
- `app/client/src/component/search-bar/index.tsx`
- `app/client/src/component/search-bar/style.ts`
- `app/client/src/component/search-bar/use-search-suggestions.ts`
- `app/client/src/component/search-bar/use-search-suggestions.test.ts`

**Modified:**
- `app/client/src/provider/book/type.ts` — `BookListFilter` type
- `app/client/src/provider/book/hook/use-fetch-book-list.ts` — new query params
- `app/client/src/provider/book/hook/use-book-list-filter.ts` — no change needed (generic)
- `app/client/src/provider/theme/theme.ts` — add `color.chip` section to `Theme` interface and `buildTheme()`
- `app/client/src/page/library/index.tsx` — swap `FilterBar` → `SearchBar`, update empty-state copy, remove `isFilterActive` logic
- `app/client/src/component/index.ts` — remove `FilterBar` export, add `SearchBar` export
- `app/server/types.ts` — `BookListFilters` type
- `app/server/routes/ui.ts` — new/changed query param validation and `filters` construction
- `app/server/services/book-store.ts` — new WHERE conditions in `listBooksPage`

---

## Testing

- `use-search-suggestions.test.ts` — unit tests: suggestion filtering, exclusivity enforcement, match offset calculation, empty input returns no groups
- `book-store.test.ts` — extend existing list tests: `query`, `author`, `seriesName`, and multi-`subjects` filter cases
- `routes/ui.test.ts` — extend existing route tests: new params accepted, `type`/`subject` params removed

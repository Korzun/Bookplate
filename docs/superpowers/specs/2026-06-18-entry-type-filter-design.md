# Entry Type Filter (Series / Single) Design

**Date:** 2026-06-18

## Goal

Add "Series" and "Single books" filter chips to the library search bar so the user can show only series rows or only standalone book rows. The filter is enforced server-side so pagination remains correct.

## Activation (Option A — Dropdown quick-picks)

When the search bar is focused with an empty input, the dropdown opens and shows:
- A **Type** group with "Series" and "Single books" options (hidden if `entryType` is already active)
- A **Status** group with "Not Started", "In Progress", "Completed" (hidden if `status` is already active)

Once the user starts typing, the dropdown switches to the existing fuzzy search results (authors, series names, book titles, subjects). The Type/Status quick-picks are only shown in the empty-input state.

## Behaviour

- Selecting **Series** hides all standalone book rows; only series rows are shown.
- Selecting **Single books** hides all series rows; only standalone books are shown.
- With no type filter active, both series and standalone items appear (current behaviour).
- The active filter renders as a chip labelled **Type** with the value "Series" or "Single books". Removing the chip clears the filter.
- `entryType` is mutually exclusive — only one value can be active at a time (selecting one replaces the other).

## Data Model

**Server** `app/server/types.ts` — `BookListFilters`:
```typescript
entryType?: 'series' | 'standalone';
```

**Client** `app/client/src/provider/book/type.ts` — `BookListFilter`:
```typescript
entryType?: 'series' | 'standalone';
```

## Server Changes

### `app/server/services/book-store.ts` — `listBooksPage`

The existing internal flags:
```typescript
const includeStandalones = filters?.seriesName === undefined;
const includeSeries = true;
```

Become:
```typescript
const includeStandalones = filters?.seriesName === undefined && filters?.entryType !== 'series';
const includeSeries = filters?.entryType !== 'standalone';
```

### `app/server/routes/ui.ts`

Parse and validate `entryType` from the query string alongside existing params:
```typescript
const entryType = req.query.entryType;
const entryTypeValue: 'series' | 'standalone' | undefined =
  entryType === 'series' || entryType === 'standalone' ? entryType : undefined;
```

Pass `entryTypeValue` into the `filters` object.

## Client Changes

### URL sync — `app/client/src/provider/book/hook/use-book-list-filter.ts`

- `filterFromSearchParams`: read `?entryType=` (validated to `'series' | 'standalone'`)
- `filterToSearchParams`: write `entryType` when set
- `filtersEqual`: compare `a.entryType === b.entryType`

### API params — `app/client/src/provider/book/hook/use-fetch-book-list.ts`

```typescript
if (bookListFilter.entryType) params.append('entryType', bookListFilter.entryType);
```

### API params — `app/client/src/provider/book/hook/use-fetch-next-page.ts`

Same one-liner as `use-fetch-book-list.ts` (mirrors all other filter params).

### Suggestion type — `app/client/src/component/search-bar/use-search-suggestions.ts`

- `Suggestion['type']` and `SuggestionGroup['type']` gain `'entryType'`
- `GROUP_LABEL` gets `entryType: 'Type'`
- `filter.entryType` added to the hook's dep list (destructured alongside `status`, `author`, etc.)
- When `inputValue` is empty, the hook returns static groups instead of `[]`:
  - Type group (items: "Series" / "Single books") — omitted if `filter.entryType` is already set
  - Status group (items: "Not Started" / "In Progress" / "Completed") — omitted if `filter.status` is already set
  - Both groups omit already-active values
- `matchStart: 0, matchLength: 0` for all static items (no highlight)
- `additive: false` for entryType items (selecting one replaces the other)

### SearchBar — `app/client/src/component/search-bar/index.tsx`

**`ChipDef`** union gains:
```typescript
| { kind: 'entryType'; value: 'Series' | 'Single books' }
```

`chip.value` holds the display label (matches the existing pattern for `status` chips where `chip.value` is the human-readable label, not the raw filter value).

**Display maps** — `TYPE_CHIP_CLASS`, `TYPE_CHIP_LABEL`, `TYPE_DROPDOWN_CLASS` each get an `entryType` entry. Chip colour class: `chipEntryType` (new, distinct from status/author/series/subject chips).

**`filterToChips`** — when `filter.entryType` is set, push:
```typescript
{ kind: 'entryType', value: filter.entryType === 'series' ? 'Series' : 'Single books' }
```

**`removeChip`**:
```typescript
case 'entryType':
  return { ...filter, entryType: undefined };
```

**`applySelection`**:
```typescript
case 'entryType':
  return { ...filter, entryType: suggestion.value as 'series' | 'standalone' };
```

**`selectSuggestion`** — `entryType` suggestions apply the filter and close (same path as `status`, no navigation).

**Placeholder text** updated to include "type":
```
'Search by title, author, series, subject, status, or type…'
```

**Dropdown visibility** — no change to the condition (`flatSuggestions.length > 0`); the hook now returns non-empty groups when focused with empty input.

## Style

`app/client/src/component/search-bar/style.ts` — add `chipEntryType` and `dropdownItemTypeEntryType` colour rules, following the same pattern as the existing chip kind styles.

## Files Changed

| File | Change |
|---|---|
| `app/server/types.ts` | Add `entryType` to `BookListFilters` |
| `app/server/routes/ui.ts` | Parse and validate `entryType` query param |
| `app/server/services/book-store.ts` | Wire `entryType` to `includeStandalones` / `includeSeries` |
| `app/client/src/provider/book/type.ts` | Add `entryType` to `BookListFilter` |
| `app/client/src/provider/book/hook/use-book-list-filter.ts` | URL sync for `entryType` |
| `app/client/src/provider/book/hook/use-fetch-book-list.ts` | Pass `entryType` in API call |
| `app/client/src/provider/book/hook/use-fetch-next-page.ts` | Pass `entryType` in pagination call |
| `app/client/src/component/search-bar/use-search-suggestions.ts` | Add `entryType` suggestion type + empty-state quick-picks |
| `app/client/src/component/search-bar/index.tsx` | Add `entryType` chip kind, display maps, handlers |
| `app/client/src/component/search-bar/style.ts` | Add `chipEntryType` + `dropdownItemTypeEntryType` styles |

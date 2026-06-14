# Library Filters Design

**Date:** 2026-06-14  
**Status:** Approved

## Overview

Add two independent filter dimensions to the Library page: **type** (standalone book or series) and **status** (reading progress). Filters are applied server-side so they work correctly with cursor-based pagination.

## Filter Dimensions

### Type
- `standalone` — books not belonging to any series
- `series` — series display units (each series is one row)
- Default (no value) — show both

### Status
- `not-started` — no progress recorded for the book (standalone) or for any book in the series
- `in-progress` — at least one book has been started but the book/series is not fully complete
- `completed` — standalone: `percentage >= 1`; series: every member book has `percentage >= 1`
- Default (no value) — show all

Series status rules:
| Condition | Status |
|---|---|
| No member book has any progress | `not-started` |
| All member books have `percentage >= 1` | `completed` |
| Otherwise (any started, not all done) | `in-progress` |

## Filter State & Data Flow

Filter state (`BookListFilter`) lives in the **book provider context** alongside `bookListItems` and `nextCursor`. When the user changes a filter:

1. `setBookListFilter(newFilter)` resets `bookListItems`, `nextCursor`, and `bookListFetched` to initial values
2. `useBookList` re-fires (it watches `bookListFilter` as a dependency) triggering a fresh page-1 fetch
3. `useFetchBookList` and `useFetchNextPage` read `bookListFilter` from context and append active values as query params (e.g. `?type=series&status=in-progress`)
4. Infinite scroll continues to work within the filtered set

## Server Changes

### `app/server/types.ts`

Add:
```ts
export type BookListFilters = {
  type?: 'standalone' | 'series';
  status?: 'not-started' | 'in-progress' | 'completed';
};
```

### `app/server/routes/ui.ts`

`GET /api/books` parses `type` and `status` query params. Invalid values respond with 400. Valid filters are forwarded to `bookStore.listBooksPage(owner, cursor, take, filters)`.

### `app/server/services/book-store.ts`

`listBooksPage` gains an optional `filters?: BookListFilters` parameter.

**Type filter:**
- `type=standalone` — skip the series query (use `[]` for series side of merge)
- `type=series` — skip the standalone query
- No filter — current behavior

**Status filter:**
1. Pre-fetch all `Progress` records for the owner into a `Map<bookId, percentage>` (one small query, negligible for a personal library)
2. Derive sets: `allStartedIds`, `inProgressIds` (0 < pct < 1), `completedIds` (pct >= 1)
3. **Standalone WHERE clause additions:**
   - `not-started`: `id: { notIn: allStartedIds }`
   - `in-progress`: `id: { in: inProgressIds }`
   - `completed`: `id: { in: completedIds }`
4. **Series filtering:**
   - Fetch all series for the owner with member book IDs (`include: { books: { select: { id: true } } }`)
   - Compute each series's status using the progress map
   - Filter to `matchingSeriesIds` matching the requested status
   - Add `id: { in: matchingSeriesIds }` to the paginated series query
   - Cursor-based ordering applies within the filtered set

## Client Changes

### `app/client/src/provider/book/type.ts`

Add:
```ts
export type BookListFilter = {
  type?: 'standalone' | 'series';
  status?: 'not-started' | 'in-progress' | 'completed';
};
```

### `app/client/src/provider/book/context.ts`

Add to `BookContext`:
- `bookListFilter: BookListFilter`
- `setBookListFilter: (filter: BookListFilter) => void`

### `app/client/src/provider/book/hook/use-fetch-book-list.ts`

Reads `bookListFilter` from context and appends active values as URL query params.

### `app/client/src/provider/book/hook/use-fetch-next-page.ts`

Same — reads `bookListFilter` and includes active filter params in the cursor page URL.

### `app/client/src/provider/book/hook/use-book-list.ts`

Adds `bookListFilter` to the dependency array so a filter change triggers a reset + re-fetch.

### `app/client/src/provider/book/hook/use-book-list-filter.ts` (new)

Thin hook wrapping context — returns `[bookListFilter, setBookListFilter]`. Exported from `provider/book/index.ts` as `useBookListFilter`.

### `app/client/src/component/filter-bar/index.tsx` (new)

A single row of two `<select>` dropdowns, one per filter dimension. Pure presentational — receives current filter values and an `onChange` callback; no direct context access.

```
[ All Types ▾ ]  [ All Statuses ▾ ]
```

- **Type dropdown options:** All Types, Standalone, Series
- **Status dropdown options:** All Statuses, Not Started, In Progress, Completed
- Selecting "All Types" or "All Statuses" clears that dimension (sets to `undefined`)
- Both dropdowns can be set simultaneously (AND logic)
- Follows the existing control styling patterns from `app/client/src/control/`

### `app/client/src/page/library/index.tsx`

- Imports `FilterBar` and `useBookListFilter`
- Renders `<FilterBar />` above the book list (hidden on empty state and error state)
- Passes current filter and `setBookListFilter` to `FilterBar`

## Testing

### Server

- **Route tests** (`routes/ui.test.ts`): `GET /api/books?type=standalone`, `?status=in-progress`, combined `?type=series&status=completed`, invalid values return 400
- **Book-store tests** (`book-store.test.ts`): each status for standalones and series, edge cases: empty series, mixed-progress series, no progress records

### Client

- **`use-fetch-book-list.test.tsx`**: filter params present in URL when filter active; absent when not
- **`use-fetch-next-page.test.tsx`**: same for next-page URL
- **`use-book-list.test.tsx`**: re-fetch fires with reset when `bookListFilter` changes

`filter-bar` is a simple controlled component; covered by the fetch hook integration tests.

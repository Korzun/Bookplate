# Library Pagination Design

**Date:** 2026-06-13  
**Status:** Approved

## Problem

`GET /api/books` currently returns every book in a user's library in a single response. `BookStore.listBooks()` does an unbounded `findMany`, the full JSON payload crosses the wire, and the client mounts every `BookRow` / `SeriesRow` card at once. For large libraries this causes slow initial loads and unnecessary memory usage.

## Goal

Introduce infinite-scroll pagination so the library page loads 20 display units at a time, with subsequent pages fetched as the user scrolls. Series must always load complete — no series may be split across pages.

---

## Data Model

### New `Series` table

```prisma
model Series {
  id      String  @id          // UUID
  userId  String
  name    String               // series name (source: Book.series)
  sortKey String               // = name; used for cursor comparison
  books   Book[]

  @@unique([userId, name])
}
```

### `Book` schema addition

```prisma
seriesId  String?
seriesRel Series? @relation(fields: [seriesId], references: [id], onDelete: SetNull)
```

The existing `series: String` field on `Book` is kept unchanged. It remains the source of truth for OPDS, KOSync, and metadata display. `seriesId` is a derived index used only for pagination queries.

### Series lifecycle (maintained in `BookStore`)

| Operation | Series side-effect |
|---|---|
| `addBook` | If `meta.series` is non-empty, upsert a `Series` row; set `book.seriesId` |
| `reimportBook` | If the series name changed, clean up the old Series row (if empty) and upsert/reassign the new one |
| `deleteBook` | If the deleted book was the last in its series, delete the `Series` row |
| `scan` | Backfill `Series` rows for existing books that have a non-empty `series` string and no `seriesId` yet |

---

## API

### Existing endpoint — unchanged shape when no pagination params

`GET /api/books` with no query parameters continues to return the full flat `Book[]` array. Existing callers (OPDS route reads `bookStore.listBooks()` directly and is unaffected; no external consumers use the flat endpoint).

### Paginated variant

`GET /api/books?cursor=<string>&take=<number>`

Both parameters are optional. When either is present, the paginated response shape is returned.

**Response:**

```json
{
  "items": [
    { "type": "standalone", "bookId": "abc123" },
    { "type": "series",     "seriesName": "Dune" }
  ],
  "books": [ ...BookSummary objects... ],
  "nextCursor": "RHVuZQ==" | null
}
```

- `items` — ordered display units for this page, capped at `take` (default 20)
- `books` — flat array of all book summaries needed to render the items: one entry per standalone book, plus all books belonging to every series in this page
- `nextCursor` — base64-encoded sort key of the last display unit; `null` when the library is exhausted
- Series are always complete: if a series appears in `items`, every book in that series is included in `books`

### Query logic (`BookStore.listBooksPage`)

```
1. series.findMany({ userId, sortKey > cursor, orderBy sortKey asc, take })
2. book.findMany({ userId, seriesId IS NULL, title > cursor, orderBy title asc, take })
3. Merge-sort both lists (each already sorted).
   Tie-breaking: series sorts before a standalone book with the same sort key.
4. Take the first `take` items.
5. For each series item in the result, fetch all its member books.
6. Return { items, books, nextCursor = last item's sortKey | null }.
```

The cursor is the `sortKey` of the last display unit on the current page.

---

## Client

### `BookProvider` context additions

| Field | Type | Description |
|---|---|---|
| `bookListItems` | `DisplayUnit[]` | Ordered display units; grows as pages load |
| `nextCursor` | `string \| null` | Cursor for the next page fetch |
| `hasMore` | `boolean` | False when `nextCursor` is null and first page has loaded |

The existing `bookList: Record<id, Book>` flat dict is retained. Books from each page are merged into it incrementally.

### Hook changes

- **`useFetchBookList`** — fetches the first page (no cursor), populates `bookListItems`, merges books into the dict
- **`useFetchNextPage`** (new) — fetches using `nextCursor`, appends display units to `bookListItems`, merges new books into the dict; no-ops if `!hasMore` or a fetch is already in flight

### `LibraryPage` changes

- Reads `bookListItems` directly from context instead of computing a sorted list from all books
- Adds an `IntersectionObserver` sentinel `<div>` at the bottom of the list; when it enters the viewport, calls `useFetchNextPage`
- `SeriesRow` and `BookRow` are unchanged — they continue reading individual book data from the flat dict

### Error handling

- Initial load failure shows the existing error state
- Mid-scroll page fetch failure shows an inline error message near the sentinel with a Retry button
- When `hasMore` is false the sentinel is not rendered

---

## Testing

| Layer | What to test |
|---|---|
| `BookStore` unit | Series upsert on `addBook`; series name change in `reimportBook`; series deletion when last book removed; `scan` backfill |
| `GET /api/books` route | Paginated response shape; cursor advances correctly; series in `items` are complete in `books`; `nextCursor` is null on last page |
| `useFetchNextPage` hook | Accumulates pages into `bookListItems`; advances cursor; does not re-fetch when `hasMore` is false |
| `LibraryPage` | Sentinel triggers next page load; series items render complete books; error state shows retry |

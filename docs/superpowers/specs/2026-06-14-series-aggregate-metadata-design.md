# Series Aggregate Metadata Design

**Date:** 2026-06-14  
**Status:** Approved

## Overview

Extend the `Series` table with five denormalised aggregate fields — `subjects`, `bookCount`, `author`, `publisher`, and `totalPages` — computed from the books in each series and kept in sync at write time. Expose the data via a new `GET /api/series/:name` endpoint and display it on the series page, including a new Subjects card.

Progress remains in the existing `Progress` table; it is already handled by `useMySeriesProgress` and stays there.

---

## Data Model

### New columns on `series`

| Column | SQLite type | Prisma field | Default |
|---|---|---|---|
| `subjects` | TEXT | `subjects String @default("[]")` | `'[]'` |
| `book_count` | INTEGER | `bookCount Int @default(0) @map("book_count")` | `0` |
| `author` | TEXT | `author String @default("")` | `''` |
| `publisher` | TEXT | `publisher String @default("")` | `''` |
| `total_pages` | INTEGER | `totalPages Int @default(0) @map("total_pages")` | `0` |

### Migration

A new Prisma DDL migration adds the five columns with `ALTER TABLE series ADD COLUMN`. SQLite accepts `NOT NULL` columns when a constant default is provided, so no table-rebuild is needed.

A data migration `data_v13_series_meta` in `migrate.ts` backfills every existing series row using the aggregation logic described below.

---

## Aggregation Logic

`recomputeSeriesMeta(client, seriesId)` is a private method on `BookStore`, typed to accept `Pick<PrismaClient, 'book' | 'series'>` so it works with both a plain client and a transaction client.

Steps:
1. Query all books with `seriesId` (fields: `subjects`, `author`, `publisher`, `pageCount`).
2. `bookCount` = row count.
3. `totalPages` = sum of `pageCount`.
4. `subjects`: flatten all `subjects` JSON arrays → case-insensitive dedup using `Map<lowercase, firstOccurrence>` → sort alphabetically → JSON-stringify.
5. `author`: collect non-empty `author` strings → case-insensitive dedup → join with `", "`.
6. `publisher`: same as author.
7. `UPDATE series SET ...` with all five values.

### Where `recomputeSeriesMeta` is called

| Operation | When | Notes |
|---|---|---|
| `addBook` | Inside a new `$transaction` wrapping the series upsert + book create | Only called if `seriesId` is set |
| `reimportBook` | Inside existing `$transaction`, after book update | Called for new `seriesId`; called for old `seriesId` only when it differs from new and the old series still has books (mirrors the existing cleanup guard) |
| `deleteBook` | Inside existing `$transaction`, in the `remaining > 0` branch | When `remaining === 0` the series row is deleted — no recompute needed |

---

## Server Read Path

### New `BookStore` method

```typescript
getSeriesByName(owner: Owner, name: string): Promise<SeriesMeta | null>
```

Where `SeriesMeta` is:

```typescript
{
  name: string;
  subjects: string[];
  bookCount: number;
  author: string;
  publisher: string;
  totalPages: number;
}
```

Queries `series` by `(userId, name)`. `subjects` is JSON-parsed from the stored string; all other fields returned as-is. Returns `null` when not found.

### New API route

```http
GET /api/series/:name
```

- Calls `resolveOwner` then `bookStore.getSeriesByName(owner, req.params.name)`.
- 404 with `{ error: 'Series not found' }` when the series does not exist.
- Otherwise returns the `SeriesMeta` object as JSON.

---

## Client

### New hook: `use-series.ts`

Fetches `GET /api/series/:name` using the same loading/error tuple pattern as other hooks in `provider/book/hook/`. Exported from `hook/index.ts` and re-exported from `provider/book/index.ts`.

### Series page changes (`page/series/index.tsx`)

- Call `useSeries(name!)` alongside the existing `useSeriesBookList` and `useMySeriesProgress`.
- Replace client-side derivations in the metadata list with stored values:
  - `seriesBookList?.length` → `series.bookCount`
  - `seriesBookList.reduce(...)` for total pages → `series.totalPages`
  - `Array.from(new Set(...))` for publisher → `series.publisher`
  - `seriesBookList[0].author` for author display → `series.author`
- Add `<Card title="Subjects">` after the Books card. Renders `<Tag>` components from `series.subjects`, same pattern as the book page. Only rendered when `subjects.length > 0`.
- `useSeriesBookList` is retained for rendering individual `<BookRow>` components.

---

## Testing

- **`book-store.test.ts`**: add cases for `recomputeSeriesMeta` via `addBook`, `reimportBook`, and `deleteBook`:
  - subjects are case-insensitively deduplicated and sorted
  - author and publisher are deduplicated and joined
  - bookCount and totalPages reflect current books
  - deleting the last book deletes the series (existing behaviour, confirm still holds)
  - editing a book's series membership updates both old and new series
- **`ui.test.ts`**: add cases for `GET /api/series/:name` — 404 for unknown series, correct aggregate fields returned.
- **`use-series.test.ts`**: loading, success, and error states.
- **Backfill migration**: covered by the existing migrate test infrastructure.

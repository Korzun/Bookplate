# Book Page Count

**Date:** 2026-05-21
**Branch:** feat/react-migration

## Overview

Add a page count field to every book using the Adobe standard page definition: 1,024 characters (including spaces) = 1 page. The count is computed from all spine content in the EPUB at import time, persisted in SQLite, and displayed in two places: the book page metadata section and the series page metadata section (as a sum across all books in the series).

## Computation

- **Unit:** Adobe standard page — 1,024 characters (including spaces).
- **Formula:** `pageCount = Math.ceil(totalCharacters / 1024)`.
- **Source:** All spine items in the EPUB (every HTML document in the spine, including front/back matter such as copyright pages, acknowledgments, appendices). This is the standard interpretation used by tools like Calibre.
- **Method:** For each spine item, get the zip entry, read as UTF-8, strip HTML tags with `/<[^>]*>/g`, add `strippedText.length` to `totalCharacters`.
- **When:** Computed during `parseEpub` in a single pass while the zip is already open. No separate file open.

## Data Model Changes

### `app/types.ts`

Add `pageCount: number` to both `EpubMeta` and `Book`.

### `app/services/epub-parser.ts`

After building `spineHrefToIndex`, iterate `spineItemRefs`, resolve each href, read and strip the entry, accumulate character count, return `pageCount` as part of `EpubMeta`.

### `app/services/book-store.ts`

- **`BookRow` interface:** add `page_count: number`.
- **Migration v8:**
  1. `ALTER TABLE books ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0` (if not present).
  2. Iterate all existing book rows, open each `<booksDir>/<id>.epub`, call `parseEpub`, update `page_count`. Skip books whose file is missing (log a warning).
  3. `PRAGMA user_version = 8`.
- **`addBook`:** include `page_count` in INSERT.
- **`reimportBook`:** include `page_count` in both UPDATE paths (id changed / id same).
- **`listBooks` / `getBookById`:** add `page_count` to SELECT.
- **`rowToBook`:** map `r.page_count → pageCount`.

## UI Changes

### Book page (`client/src/page/book/index.tsx`)

Add a `pages` metadata entry after `chapters`, before `publisher`, conditional on `book.pageCount > 0`:

```tsx
if (book !== undefined && book.pageCount > 0) {
  metadata.push({ title: 'pages', value: book.pageCount.toString() });
}
```

### Series page (`client/src/page/series/index.tsx`)

Add a `pages` metadata entry after `books`, before `publisher`. Show when the sum is greater than 0:

```tsx
const totalPages = seriesBookList.reduce((sum, book) => sum + book.pageCount, 0);
if (totalPages > 0) {
  metadata.push({ title: 'pages', value: totalPages });
}
```

A partial sum (some books at 0) is acceptable — it's shown as-is.

## Testing

- Unit test in `epub-parser.test.ts`: mock a minimal EPUB with known text content and assert the computed `pageCount`.
- Unit test in `book-store.test.ts`: verify `addBook` and `listBooks` round-trip `pageCount` correctly; verify migration v8 backfill updates existing rows.
- The migration v8 backfill is tested by creating a DB at v7 with a book row and verifying `page_count` is populated after `migrate()` runs.

## Out of Scope

- Manual override of page count (not editable in the book-edit form).
- Per-chapter page count breakdown.
- Displaying page count in book list rows or search results.

# Cover Thumbnails Design

**Date:** 2026-05-18  
**Status:** Approved

## Overview

Generate resized cover thumbnails for each book at import time and serve them on demand via the existing cover endpoints. Thumbnails are stored in SQLite alongside the full-size cover, cleaned up automatically when a book is deleted, and generated asynchronously to avoid blocking the import pipeline or straining Home Assistant's limited CPU and memory.

## Config

Two widths are configured in `options.json` (and surfaced through `app/config.ts`):

```json
{ "thumbnail_widths": [60, 170] }
```

Widths are read at startup. The reconciliation step (see below) generates any missing thumbnails and prunes any widths that are no longer in config.

## Database Schema

New table added via migration:

```sql
CREATE TABLE book_thumbnails (
  book_id  INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  width    INTEGER NOT NULL,
  data     BLOB    NOT NULL,
  mime     TEXT    NOT NULL,
  PRIMARY KEY (book_id, width)
);
```

`ON DELETE CASCADE` means thumbnails are removed automatically when a book row is deleted — no explicit cleanup logic needed.

## Generation Queue

A new `ThumbnailQueue` class in `app/services/thumbnail-queue.ts` owns the in-memory queue and all generation logic.

### Startup flow

1. Read configured widths from config.
2. **Prune:** `DELETE FROM book_thumbnails WHERE width NOT IN (<configured widths>)` — synchronous, fast.
3. **Reconcile:** Query for all `(book_id, width)` pairs that exist in `books` but not in `book_thumbnails`. Push each missing pair onto the queue.
4. Start the processor loop.

### Processor

- Processes one job at a time (single concurrency to protect HA resources).
- 200ms pause between jobs.
- Per job: read `cover_data` + `cover_mime` from `books`, resize with `sharp`, write result to `book_thumbnails`.
- Failed jobs are logged and skipped — one bad cover does not block the queue.

### Image resizing

```ts
sharp(coverBuffer)
  .resize({ width, withoutEnlargement: true })
  .jpeg({ quality: 80 })
  .toBuffer()
```

`withoutEnlargement: true` prevents upsizing covers that are already smaller than the target width. Output is always JPEG regardless of the original format.

### New import hook

After a successful book import, `BookStore.importBook()` calls `thumbnailQueue.enqueue(bookId)`, which pushes one job per configured width onto the queue.

## API

Both cover endpoints accept an optional `?width=` query parameter:

- `GET /api/books/:id/cover?width=60`
- `GET /opds/books/:id/cover?width=60`

**Lookup logic:**

1. If `width` param is present and a matching `book_thumbnails` row exists → serve it.
2. Otherwise → fall back to the full-size `cover_data` blob and log a warning:  
   `Cover thumbnail width={width} not found for book {id}, serving full-size`

The endpoints are fully backwards-compatible: callers that omit `?width=` continue to receive the original full-size cover.

### OPDS thumbnail link

The OPDS feed gains a `<link rel="http://opds-spec.org/image/thumbnail">` entry using the smallest configured width (60px), giving OPDS clients like KOReader a proper thumbnail URL in the catalog feed.

## Frontend

The `Cover` component (`client/src/component/cover/`) gains an optional `width` prop. When provided, it appends `?width=${width}` to the cover URL.

| Component | Display size | Requested width |
|---|---|---|
| `book-row` | 43×60px | `?width=60` |
| `book` page | 80×114px | `?width=170` |
| `cover-stack` | 120×170px | `?width=170` |

## Dependencies

- `sharp` — added as a production dependency. Fast, libvips-backed image processing for Node.js.

## Out of Scope

- Showing thumbnail generation progress in the admin UI.
- Per-book manual regeneration endpoint.
- Formats other than JPEG for thumbnail output.

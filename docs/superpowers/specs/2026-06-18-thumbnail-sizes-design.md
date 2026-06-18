# Thumbnail Sizes — Right-size for 1.6:1 Cover Ratio

**Date:** 2026-06-18

## Context

The client was updated to display book covers at a 1.6:1 (height:width) ratio. Display sizes are:

| Context | CSS width | CSS height |
|---|---|---|
| Book list row | 43px | 68px |
| Series row cover stack | 43px | 68px |
| Series page cover stack | 80px | 128px |
| Book detail page | 80px | 128px |

The server generates thumbnails by width only (sharp resizes by width, height floats with the cover's native aspect ratio). The stored thumbnail widths must match what the client requests via `?width=<n>`.

Before this change the server generated `[60, 170]` and the client requested those widths. Neither size was proportionate to the actual display dimensions (60px thumbnail for 43px display; 170px for 80px display).

## Decision

Generate thumbnails at **2× the CSS pixel dimensions** for retina-crisp rendering on HiDPI screens:

- **86px** (43 × 2) — used by book list rows and series row cover stacks
- **160px** (80 × 2) — used by series page cover stacks and the book detail page

## Files Changed

| File | Change |
|---|---|
| `app/server/config.ts` | Default `thumbnail_widths`: `[60, 170]` → `[86, 160]` |
| `app/client/src/component/book-row/index.tsx` | Request `?width=86` (was 60) |
| `app/client/src/component/cover-stack/index.tsx` | `thumbnailWidth={160}` (was 170) |
| `app/client/src/page/book/index.tsx` | Request `?width=160` (was 170) |
| `app/server/services/thumbnail-queue.ts` | Add logging (see below) |
| `app/server/routes/ui.test.ts` | Update fixture `thumbnailWidths: [60, 170]` → `[86, 160]` |

## Logging Changes (`thumbnail-queue.ts`)

**Successful generation** — `processJob()` logs after `saveThumbnail` succeeds:
```
Generated 86px thumbnail for book <bookId>
```

**Width-change detection** — `start()` uses the count returned by `pruneThumbnails` (already returns `number`). `reconcile()` is changed to return `{ bookCount: number }` (unique books with missing thumbnails) instead of logging internally. `start()` emits a single combined log when a width change is detected:
```
Thumbnail widths changed — regenerating covers for 42 book(s) (pruned 84 stale thumbnails)
```

`reconcile()` no longer logs on its own — the `/scan` route already logs its own summary after calling `reconcile()`, so that path is covered.

## Migration

No DB migration is required. On server boot, `ThumbnailQueue.start()` calls `pruneThumbnails([86, 160])` which deletes stored 60px and 170px thumbnails, then `reconcile()` enqueues 86px and 160px thumbnail generation for all books that have a cover.

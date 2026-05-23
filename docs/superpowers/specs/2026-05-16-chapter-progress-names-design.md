# Chapter Progress Names — Design Spec

**Date:** 2026-05-16
**Status:** Approved

## Summary

Extend the chapter progress feature to store and display each chapter's title alongside its number. The `ChapterProgress` control currently shows "5 / 24"; after this change it will show "Ch 5: The Storm / 24" when a name is available, or "Ch 5 / 24" when it is not.

---

## Data Layer

**EPUB parser** (`app/services/epub-parser.ts`)

The parser already flattens all nav entries (EPUB 3 `<nav>`, EPUB 2 NCX) into a list used to compute `chapterCount` and `chapterSpineMap`. Extend this to also collect each entry's text content as a title string, returning a `chapterNames: string[]` parallel to the existing `chapterSpineMap: number[]`. No structural changes to parsing logic — just capture the label that's already in scope.

**Database** (`app/db/migrations/`)

Add migration v5 with a single new column:

```sql
ALTER TABLE books ADD COLUMN chapter_names TEXT;
```

Stores the title array as a JSON string. Existing rows have `NULL`, which maps to `[]` in application code.

**Book store** (`app/services/book-store.ts`)

- `rowToBook()`: JSON-parse `chapter_names` column; default to `[]` on `NULL`.
- `saveBook()` / `updateBook()`: serialize `chapterNames` to JSON on write.

**Types** (`app/types.ts`)

Add `chapterNames: string[]` to the `Book` interface (always present, empty array as default).

---

## API Layer

**Route** (`app/routes/ui.ts` — `GET /api/my/progress`)

After the existing `currentChapter` computation, look up the name:

```typescript
const currentChapterName =
  currentChapter != null && book.chapterNames.length > 0
    ? book.chapterNames[currentChapter - 1]
    : undefined;
```

Include `currentChapterName` in the response object. The field is omitted when undefined — no change to the response shape for books without names.

**Client type** (`client/src/provider/progress/type.ts`)

Add `currentChapterName?: string` to the `Progress` type.

---

## UI Layer

**`ChapterProgress` component** (`client/src/control/chapter-progress/index.tsx`)

Add optional `name?: string` prop. Display logic:

- `name` present → `Ch {current}: {name} / {total}`
- `name` absent → `Ch {current} / {total}`

**Book page** (`client/src/page/book/index.tsx`)

Pass `progress.currentChapterName` through to `ChapterProgress` alongside the existing `currentChapter` and `chapterCount` props.

---

## Error Handling & Edge Cases

- **Books imported before migration:** `chapter_names` is `NULL` → mapped to `[]` → `currentChapterName` is `undefined` → falls back to "Ch N / total" display.
- **Nav entries with empty/missing labels:** Treat as empty string; the server omits `currentChapterName` if the resolved name is falsy (`!name`), so the UI falls back gracefully.
- **Chapter index out of range:** `chapterNames[currentChapter - 1]` returns `undefined` if the arrays are mismatched; same fallback applies.

---

## Testing

- Unit test `parseCfiSpineIndex` and `spineIndexToChapter` are unchanged — no new CFI logic.
- Unit test the EPUB parser: verify `chapterNames` is returned and matches nav entry labels.
- Unit test `rowToBook`: `NULL` column → `[]`, valid JSON → parsed array.
- Integration test `GET /api/my/progress`: verify `currentChapterName` is present when book has names, absent when it does not.
- UI: `ChapterProgress` renders both forms ("Ch 5: The Storm / 24" and "Ch 5 / 24").

---

## Out of Scope

- Admin UI for viewing/editing chapter names.
- Exposing `chapterNames` array directly to the client (only the current chapter's name is sent).
- Retroactive re-import of existing books to populate names (users can trigger reimport manually if desired).

# Chapter Count Design

**Date:** 2026-05-16
**Branch:** feat/react-migration

## Goal

Surface the total number of chapters for a book in two places:
1. The book detail page, as a metadata entry ("chapters: 24")
2. The `ChapterProgress` component, replacing dummy values with real `current` and `total`

## Approach

Parse chapter data from the EPUB nav document at import time, store it in the database, expose `chapterCount` via the book API, and compute `currentChapter` server-side from the stored KoSync CFI string before returning it via the progress API.

"Chapters" are defined as **nav document entries** (not spine items), flattened across all nesting levels. This excludes cover pages, TOC pages, and other non-chapter spine items that the user would not recognise as chapters.

---

## Section 1: EPUB Parsing

**File:** `app/services/epub-parser.ts`

Two fields added to `EpubMeta`:

| Field | Type | Description |
|---|---|---|
| `chapterCount` | `number` | Total nav entries (flattened) |
| `chapterSpineMap` | `number[]` | 0-based spine index for each nav entry, in order |

**Algorithm:**

1. Build a map of `manifestId → spineIndex` by iterating `pkg.spine.itemref[]` in order.
2. Locate the nav document:
   - EPUB 3: manifest item with `@_properties === 'nav'`
   - EPUB 2: manifest item with `@_media-type === 'application/x-dtbncx+xml'`
3. Parse the nav document and extract all nav entries (flatten nested `<ol>` / `<navPoint>` hierarchies).
4. For each entry, strip the fragment from the href (`chapter2.xhtml#s1` → `chapter2.xhtml`) and find the matching manifest item, then look up its spine index.
5. Emit `chapterSpineMap` as the ordered list of resolved spine indices, `chapterCount` as its length.

**Example output:**

```
chapterSpineMap = [2, 3, 4, 5, 6, 7]  // 6 nav entries, spine positions 2–7
chapterCount    = 6
```

---

## Section 2: Database & Server Types

**File:** `app/services/book-store.ts` — migration v4

```sql
ALTER TABLE books ADD COLUMN chapter_count     INTEGER NOT NULL DEFAULT 0
ALTER TABLE books ADD COLUMN chapter_spine_map TEXT    NOT NULL DEFAULT '[]'
```

- `addBook`, `reimportBook`, and `rowToBook` updated to read/write both columns.
- `chapterSpineMap` is **not** exposed in the API response — it is DB-internal, used only by the progress endpoint.
- `chapterCount` is included in the server `Book` type (`app/types.ts`) and returned by both `GET /api/books` and `GET /api/books/:id`.

**Existing books:** rows created before this migration get `chapter_count = 0` and `chapter_spine_map = '[]'`. They degrade gracefully on the UI (see Section 4). A full-library reimport via admin tools will populate them.

---

## Section 3: Progress API

**File:** `app/routes/ui.ts` — `GET /api/my/progress`

Response shape gains one optional field:

```ts
{ document: string; percentage: number; currentChapter?: number }
```

**Computation (per progress record):**

1. Fetch `chapter_spine_map` for each book via a single SQL JOIN on `progress.document = books.id`.
2. Parse `currentChapter` from the stored CFI string:
   - KoReader format: `EPUB_CFI(/6/N[id]!/...)`
   - Extract `N`, compute `spineIndex = (N - 2) / 2`
   - Find the last entry in `chapterSpineMap` where `value ≤ spineIndex` — its 1-based position is `currentChapter`
3. If the CFI is absent or malformed, omit `currentChapter` from the response.

**Example:**

```
chapterSpineMap = [2, 3, 4, 5]
CFI: EPUB_CFI(/6/10[ch3]!/4/1:0)  →  N=10  →  spineIndex=4
Last map entry ≤ 4 is index 2 (value 4)  →  currentChapter = 3
```

---

## Section 4: Client

**`Book` type** (`client/src/provider/book/type.ts`):
```ts
chapterCount: number;
```

**`Progress` type** (`client/src/provider/progress/type.ts`):
```ts
currentChapter?: number;
```

**Book page** (`client/src/page/book/index.tsx`):

- Metadata list: add `{ title: 'chapters', value: book.chapterCount.toString() }` when `chapterCount > 0`.
- `ChapterProgress` condition:
  ```tsx
  {progress && progress.percentage > 0 && book.chapterCount > 0 && progress.currentChapter != null && (
    <ChapterProgress current={progress.currentChapter} total={book.chapterCount} />
  )}
  ```

---

## Out of Scope

- Bulk reimport UI for populating chapter data on existing books (follow-on)
- Displaying chapter titles in the UI
- Filtering nav entries by depth (all entries are flattened)

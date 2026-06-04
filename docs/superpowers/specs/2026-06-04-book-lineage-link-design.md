# Book Lineage Link / Unlink

**Date:** 2026-06-04  
**Status:** Approved

## Overview

Synced reading progress can arrive with a document ID that no longer (or never did) match a live book — the book was deleted, renamed outside the system, or synced from a device that had a stale ID. Admins need a way to associate these orphaned progress records with the correct book lineage, and to undo that association if it was made in error.

Two surfaces are affected:

1. **`UserProgressRow`** — a "Link" button (admin-only, visible only when the document ID resolves to no known book) opens a modal where the admin picks the target book.
2. **`BookLineageCard`** — linked ("merged") IDs appear in the git-graph lineage view and carry an "Unlink" button.

---

## Data Model

### `book_id_history` — new `type` column

```sql
ALTER TABLE book_id_history
  ADD COLUMN type TEXT NOT NULL DEFAULT 'edit'
  CHECK (type IN ('edit', 'merge'));
```

- All existing rows (organic reimport/rename chains) get `type = 'edit'` automatically via the `DEFAULT`.
- Admin-linked entries get `type = 'merge'`.
- SQLite enforces the CHECK at write time. Prisma does not model CHECK constraints for SQLite, so the `BookIdHistory` model gains `type String @default("edit")` — the constraint lives only in the migration SQL.

Migration file: `app/server/prisma/migrations/0003_add_book_id_history_type/migration.sql`

(Name follows the existing convention: `0001_add_book_id_history`, `0002_add_book_id_history_timestamp`.)

### Prisma schema update

Add to the `BookIdHistory` model:

```prisma
type String @default("edit")
```

---

## Server API

All write endpoints require admin authentication (same middleware already applied in `app/server/routes/users.ts`). The new endpoints are added to `app/server/routes/ui.ts` under an `adminAuth` guard, alongside the existing `/api/books/:id/lineage` GET.

### `GET /api/books/:id/lineage` (updated)

Each entry object now includes `type: 'edit' | 'merge'`. No breaking change — new field added.

```json
{
  "currentId": "abc123",
  "entries": [
    { "oldId": "def456", "newId": "abc123", "timestamp": 1748908560000, "type": "edit" },
    { "oldId": "orphan789", "newId": "abc123", "timestamp": 1748908600000, "type": "merge" }
  ]
}
```

### `POST /api/books/:id/link`

Links an orphaned document ID to book `:id`.

**Request body:** `{ "documentId": "<orphaned-document-id>" }`

**Validations:**
- `:id` must be a live book (`404` if not)
- `documentId` must not equal `:id` (`400`)
- `documentId` must not already appear as `old_id` in `book_id_history` pointing to any live book (`409`)

**On success:**
1. Resolve per-user progress conflicts: for every user who has progress under `documentId`, if they also have progress under `:id`, keep whichever has the later `timestamp` (newer-wins — same logic as `reimportBook`).
2. Migrate remaining progress from `documentId` to `:id` via `deleteMany` + `createMany`.
3. Insert `book_id_history (documentId, :id, now, 'merge')`.
4. Return `204`.

**Errors:** `400` bad body, `404` book not found, `409` already linked.

### `DELETE /api/books/:id/link/:documentId`

Unlinks a merge entry.

**Validations:**
- The `book_id_history` row `(documentId, :id)` must exist and have `type = 'merge'` (`404` if missing, `400` if it's an `'edit'` row — edit history is immutable via this endpoint).

**On success:**
1. Delete the single `book_id_history` row.
2. Leave all progress records untouched (progress stays on `:id`).
3. Return `204`.

---

## Client

### Types

`LineageEntry` (`app/client/src/provider/book/hook/use-book-lineage.ts`) gains:

```ts
type LineageEntry = {
  oldId: string;
  newId: string;
  timestamp: number;
  type: 'edit' | 'merge';
};
```

### New hooks

**`useLinkProgress(bookId: string)`** — `app/client/src/provider/progress/hook/use-link-progress.ts`

Posts to `POST /api/books/:bookId/link`. Returns `[link, loading, error]`. Placed in the progress provider (not the book provider) because its primary side-effect is invalidating the user's progress list. On success, calls the progress context's refetch for the relevant username so the orphaned row disappears from `UserRowContent`.

**`useUnlinkBookLineage(bookId: string)`** — `app/client/src/provider/book/hook/use-unlink-book-lineage.ts`

Calls `DELETE /api/books/:bookId/link/:documentId`. Returns `[unlink, loading, error]`. On success, triggers a refetch of the book lineage.

**`useBookLineage` refetch**

The hook gains a `refetch` function so `useUnlinkBookLineage` can invalidate it. The tuple is extended to `[data, loading, error, refetch]` where `refetch: () => void` re-triggers the fetch for the current `bookId`.

### `UserProgressRow`

`app/client/src/component/user-progress-row/index.tsx`

- Imports `useIsAdmin` and `useBook`.
- When `book === undefined && !bookLoading && isAdmin === true`, renders a small `Button type="text"` labelled "Link" in place of (or alongside) the raw document ID. The `!bookLoading` guard prevents the button flashing during the initial fetch.
- Clicking opens `LinkProgressModal` with `documentId={bookId}` and `username={username}`.
- The component already calls `useBook(bookId)` — this condition is already computable with no new fetch.

### `LinkProgressModal`

New control: `app/client/src/control/link-progress-modal/index.tsx`

Structure mirrors `SetProgressModal`:

```
<dialog> (theme.recipe.modal.dialog)
  header: "Link Progress"
  body:
    - Text input: filter books by title (controlled, filters useBookList() in-memory)
    - Scrollable list: matching books showing title + author
      - Clicking a row selects it (highlighted state)
    - Inline error area (shown on API failure)
  footer: (theme.recipe.modal.footer)
    - Cancel (Button type="text")
    - Link (Button type="primary", disabled until a book is selected, loading during API call)
```

**Props:**
```ts
type LinkProgressModalProps = {
  isOpen: boolean;
  documentId: string;
  username: string;
  onClose: () => void;
};
```

**Behaviour:**
- Book list is sourced from `useBookList()` — already loaded in context, no extra fetch.
- On confirm: calls `useLinkProgress(selectedBookId)` with `{ documentId }`.
- On success: calls `onClose()`. The progress list refetch (triggered inside `useLinkProgress`) causes `UserRowContent` to re-render without the orphaned row.
- On error: shows error message inline, modal stays open.

### `BookLineageCard` — git-graph visual rework

`app/client/src/component/book-lineage-card/index.tsx` + `style.ts`

#### Row ordering

Same as today: current at top, then prior IDs newest-first. Merge entries are interleaved by timestamp — they appear at the position their timestamp places them in the chain.

#### Connector column

The `connector` div is replaced with a small inline SVG (fixed-width ~40px, height fills the row). Each SVG encodes the track segment for its row:

**Edit / current / initial rows:**
- 10px filled circle, centred at x=5
- Vertical line from circle bottom to SVG bottom on x=5 (omitted for the last row)

**Merge rows:**
- 10px filled circle at x=25 (offset right)
- Short horizontal segment from x=23 to x=12, then a quarter-circle curve up to x=5 at the top of the row — connecting back to the main track
- The row *above* a merge row draws its vertical line all the way down through the merge row's y-range, so the main track reads as uninterrupted

#### Dot colours (from design system)

| Entry type | Colour token |
|---|---|
| `current` | `theme.color.brand.default` |
| `edit` (intermediate) | `theme.color.blue[400]` |
| `initial` | `theme.color.success` |
| `merge` | `#7C3AED` (one-off purple; not in palette) |

#### Badges

`current` and `initial` text badges are retained. No new badge for merge — the visual position (branching in from the side) distinguishes them.

#### Unlink button

Merge entries render a small `Button type="text" danger` labelled "Unlink" in the `entryContent` area. Clicking calls `useUnlinkBookLineage` with that entry's `oldId`. On success, the lineage refetches and the entry disappears.

---

## File Checklist

| File | Change |
|---|---|
| `app/server/prisma/migrations/0003_add_book_id_history_type/migration.sql` | New — `ALTER TABLE` to add `type` column |
| `app/server/prisma/schema.prisma` | Add `type String @default("edit")` to `BookIdHistory` |
| `app/server/services/book-store.ts` | Add `linkDocument(bookId, documentId)` and `unlinkDocument(bookId, documentId)` methods |
| `app/server/routes/ui.ts` | Add POST + DELETE endpoints under `adminAuth` |
| `app/server/routes/ui.test.ts` | Tests for both endpoints |
| `app/client/src/provider/book/hook/use-book-lineage.ts` | Add `type` to `LineageEntry`; expose `refetch` |
| `app/client/src/provider/progress/hook/use-link-progress.ts` | New hook |
| `app/client/src/provider/book/hook/use-unlink-book-lineage.ts` | New hook |
| `app/client/src/provider/book/hook/index.ts` | Export new hooks |
| `app/client/src/component/book-lineage-card/index.tsx` | Git-graph connector SVG, unlink button |
| `app/client/src/component/book-lineage-card/style.ts` | Updated styles for new layout |
| `app/client/src/component/user-progress-row/index.tsx` | Add Link button (admin + unresolved only) |
| `app/client/src/control/link-progress-modal/index.tsx` | New modal |
| `app/client/src/control/link-progress-modal/style.ts` | New styles |
| `app/client/src/control/index.ts` | Export `LinkProgressModal` |

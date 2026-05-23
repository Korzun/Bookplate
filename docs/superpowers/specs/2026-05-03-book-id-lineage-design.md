# Book ID Lineage — Progress Attribution Design

**Date:** 2026-05-03

## Problem

Book IDs are partial MD5 hashes of the EPUB file's bytes. Editing a book's metadata rewrites the EPUB file, which changes the hash and therefore the ID. When this happens the server already cascades existing progress records to the new ID (via `UPDATE progress SET document=? WHERE document=?` in `reimportBook`).

The gap is **external devices** (KoReader and similar). A device that downloaded the book before the edit still has the original file with the original ID. When it syncs progress via the KOSync API it sends the old ID. The server stores that progress under the orphaned ID, and the web UI shows 0% for the current book.

## Approach — Flattened lineage table

A new `book_id_history` table maps every old ID directly to the **current** ID of the book it once belonged to. Entries are kept flat: on each reimport any prior history entries that pointed to the old ID are updated to point to the new one. This gives O(1) resolution at sync time with a single query.

## Data Layer (`BookStore`)

### New table (next migration)

```sql
CREATE TABLE IF NOT EXISTS book_id_history (
  old_id     TEXT PRIMARY KEY,
  current_id TEXT NOT NULL
)
```

### `reimportBook()` additions

When `newId !== id`, inside the existing transaction, after updating the book row and cascading progress:

```sql
-- Record the new mapping
INSERT OR REPLACE INTO book_id_history (old_id, current_id) VALUES (?, ?)  -- (id, newId)

-- Flatten any prior chain entries (e.g. X→id becomes X→newId)
UPDATE book_id_history SET current_id = ? WHERE current_id = ?  -- (newId, id)
```

### `deleteBook()` addition

```sql
DELETE FROM book_id_history WHERE old_id = ? OR current_id = ?  -- (id, id)
```

Prevents dead entries accumulating for deleted books.

### New method: `resolveBookId(id: string): string`

```ts
resolveBookId(id: string): string {
  const row = this.db
    .prepare('SELECT current_id FROM book_id_history WHERE old_id = ?')
    .get(id) as { current_id: string } | undefined;
  return row ? row.current_id : id;
}
```

Returns the current ID for any point in a book's history. Returns the input unchanged if no history entry exists (i.e. the ID is already current, or is entirely unknown).

## KOSync Route

`createKosyncRouter` gains a second parameter: `bookStore: BookStore`.

Both sync endpoints call `bookStore.resolveBookId()` before hitting `userStore`:

**PUT `/kosync/syncs/progress`**
```ts
const currentId = bookStore.resolveBookId(document);
const saved = userStore.saveProgress(user, { ...body, document: currentId });
// Response returns the original document ID the device sent (KOSync spec compliance)
res.status(200).json({ document, timestamp: saved.timestamp });
```

**GET `/kosync/syncs/progress/:document`**
```ts
const currentId = bookStore.resolveBookId(req.params.document);
const p = userStore.getProgress(user, currentId);
if (!p) { res.status(404).json({ message: 'Not found' }); return; }
res.status(200).json(p);
```

If `resolveBookId` returns a `current_id` that no longer exists in `books` (book deleted after history was written), the behaviour is unchanged — progress is stored or returned as normal; the web UI naturally shows nothing for deleted books.

## Migration note

Existing progress records stored under old IDs before this feature lands cannot be retroactively resolved — historical ID mappings were never recorded. They remain orphaned. All syncs after deployment will resolve correctly going forward.

## Tests

### `BookStore` (`app/services/book-store.test.ts`)

| Test | What it verifies |
|---|---|
| `resolveBookId` — no history | Returns input unchanged |
| `resolveBookId` — single hop A→B | Returns B |
| `resolveBookId` — multi-hop A→B→C | `resolveBookId(A)` returns C; `resolveBookId(B)` returns C |
| `deleteBook` cleans up history | After delete, history entries for that ID are gone |

### KOSync route (`app/routes/kosync.test.ts`)

| Test | What it verifies |
|---|---|
| PUT with old ID | Progress stored under current ID (verified by GET with current ID) |
| GET with old ID | Returns progress stored under current ID |
| PUT/GET with current ID | Unaffected; behaves as today |
| PUT with unknown ID (no book, no history) | Progress saved as-is; existing permissive behaviour preserved |

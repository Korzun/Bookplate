# Book Filename Canonicalization Design

**Date:** 2026-05-18
**Branch:** feat/canonical-book-filenames

## Summary

Make the on-disk filename of every book equal to its 32-character partial-MD5
identifier (`<id>.epub`). Keep that invariant across every operation that can
change the hash: upload, metadata edit, library scan, startup migration.
Decouple this from the user-facing filename used when a book is downloaded,
which is derived from the book's metadata.

The user-facing download name format is:

```
[author]-[series]-[series_index]-[title].epub
```

Series and index are omitted when the book is not part of a series. Within each
field, spaces become underscores; the `-` between fields is the field separator.

## Storage model

- Canonical on-disk layout: `<booksDir>/<id>.epub` for every book.
- The `books` table drops its `filename` and `path` columns. Both are
  computable from `id`:
  - `path = path.join(booksDir, id + '.epub')`
  - `filename` becomes the *download name* (see rules below), computed on read.
- `Book.filename` (in `app/types.ts`) keeps its name but changes meaning: it is
  now "what the file should be called when handed to a user." OPDS already uses
  this field in the `Content-Disposition` header, so no caller needs to be
  aware of the semantic shift.

### Schema migration (`user_version = 7`)

For each row in `books`:

1. Read the current on-disk path (the existing `path` column).
2. If the file doesn't exist on disk, log a warning, skip the row, leave the
   row in place — the next scan will reconcile.
3. If the file exists, compute the target `<booksDir>/<id>.epub`.
   - If source and target are the same path, no rename.
   - If a different file already occupies the target (existing file's bytes
     differ from the source — practically only if a partial-MD5 collision
     occurs), log a warning and skip the row.
   - Otherwise rename source → target.
4. After processing all rows, drop the `filename` and `path` columns. Because
   `filename` carries a `UNIQUE` index, SQLite requires a table rebuild for
   `DROP COLUMN` in this case: create a new `books` table with the target
   shape, `INSERT INTO new_books SELECT … FROM books`, drop the old table,
   rename. Do this inside a transaction along with `PRAGMA user_version = 7`.

Log a summary count of renamed and skipped rows.

## Download-filename rules

New pure utility `app/utils/download-filename.ts`:

```ts
export function downloadFilename(book: {
  author: string;
  series: string;
  seriesIndex: number;
  title: string;
}): string;
```

### Field preparation

1. `author` → trim. If empty, substitute `Unknown`.
2. `title` → trim. If empty, substitute `Unknown`.
3. `series` → trim. If empty, omit both `series` and `series_index` from the
   output entirely.
4. `seriesIndex` → `Number(n).toString()` (drops trailing zeros: `1.0` → `1`,
   `1.5` → `1.5`). Then `.` → `_` so `1.5` becomes `1_5`. If `series` is
   non-empty but `seriesIndex` is `0`, emit `0`.

### Per-field sanitization

Applied to each prepared field (author, series, seriesIndex, title):

1. Strip control characters: `\x00`–`\x1f` and `\x7f`.
2. Strip filesystem-illegal characters: `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`.
3. Collapse runs of whitespace (spaces, tabs) to a single space.
4. Replace each remaining space with `_`.
5. Strip leading/trailing `_` and `.`.
6. If a required field (author or title) becomes empty after sanitization,
   substitute `Unknown`. If `series` becomes empty after sanitization, treat as
   absent and omit `series` and `series_index`.

### Assembly

- With series: `<author>-<series>-<series_index>-<title>.epub`
- Without series: `<author>-<title>.epub`

### Examples

| Author | Series | Index | Title | Result |
|---|---|---|---|---|
| `J.R.R. Tolkien` | `The Lord of the Rings` | `1` | `The Fellowship of the Ring` | `J.R.R._Tolkien-The_Lord_of_the_Rings-1-The_Fellowship_of_the_Ring.epub` |
| `Brandon Sanderson` | `Stormlight Archive` | `1.5` | `Edgedancer` | `Brandon_Sanderson-Stormlight_Archive-1_5-Edgedancer.epub` |
| `Frank Herbert` | _(empty)_ | `0` | `Dune` | `Frank_Herbert-Dune.epub` |
| _(empty)_ | _(empty)_ | `0` | _(empty)_ | `Unknown-Unknown.epub` |
| `Sue / Bob` | _(empty)_ | `0` | `Path: A Memoir` | `Sue_Bob-Path_A_Memoir.epub` |

## Touchpoints

### `app/services/book-store.ts`

- `BookRow` loses `filename` and `path`.
- `rowToBook` computes `filename` via `downloadFilename(row)` and `path` via
  `path.join(booksDir, id + '.epub')`.
- `addBook(id, srcPath, size, mtime, meta)` — signature drops `filename`. If
  `srcPath !== <booksDir>/<id>.epub`, the file is moved there. If the row
  already exists, throw a new `BookAlreadyExistsError(id)`.
- `reimportBook(id)` — when `newId !== id`, rename the file on disk from
  `<id>.epub` to `<newId>.epub` *before* the DB update, inside the same
  transaction. Existing `BookHashCollisionError` continues to be thrown when
  the new id is already present in the DB.
- `deleteBook` — unlinks `<booksDir>/<id>.epub`.
- `scan()` — for each `.epub` in `booksDir`, compute `id = partialMD5(file)`;
  if the file isn't already named `<id>.epub`, rename it (handling collisions
  the same way as the migration). Then import as usual.
- `migrate()` — adds the `user_version = 7` block described in the Schema
  migration section.

### `app/routes/ui.ts`

- Multer destination changes to a staging directory (`<booksDir>/.staging/`,
  created on demand). The original filename is retained for staging only so
  parse error messages stay readable; once parsed, `BookStore.addBook` moves
  the file to its canonical location and the original name is discarded.
- The frontend's `useUploadQueue` posts one file per request, so the existing
  "first error wins" pattern is preserved. The response shape stays
  `{ uploaded: [...] }` on success.
- A `BookAlreadyExistsError` caught from `addBook` returns `409` with
  `{ error: 'A book with the same fingerprint is already in the library.' }`
  and unlinks the staged file. (If a future caller batches multiple files in
  one request, the existing early-return-on-error behavior also applies to
  duplicates; matches today's parse-error semantics.)
- `Book.filename` is already part of the response from `/api/books` and
  `/api/books/:id`. No additional field-filtering changes are needed; clients
  begin seeing the new download-style name automatically.

### `app/routes/opds.ts`

No code change. `book.filename` now contains the computed download name, which
is exactly what `Content-Disposition` should carry.

### `app/types.ts`

`Book.filename` keeps its field signature; its meaning becomes "download name."
A short comment on the field documents this.

## Error handling

- **Duplicate on upload:** `BookAlreadyExistsError` is caught by the upload
  route. The staged file is unlinked. Multi-file uploads report per-file
  errors; the request only fails outright (`409`) if every file was a
  duplicate.
- **On-disk collision with a different file:** when migration or scan would
  rename `X.epub` → `<id>.epub` but a different file already occupies the
  target, log a warning and skip — leaves the DB row pointing at a path that
  scan will subsequently report as missing and remove. Acceptable; this is
  vanishingly rare (would require a real partial-MD5 collision).
- **Metadata edit hash collision (existing flow):** unchanged. `reimportBook`
  performs the file rename and DB update in the same transaction; rename
  failure aborts the transaction and the file is not moved.
- **Missing file during migration:** log a warning, skip the row, do not
  abort. Next scan reconciles.

## Testing

### `app/utils/download-filename.test.ts` (new)

Table-driven cases covering:

- With-series happy path.
- Without-series happy path.
- Integer index (`1`), one-decimal (`1.5`), exact-zero (`0`).
- Empty author, empty title, both empty.
- Illegal chars in each field: `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`.
- Control characters (`\x00`, `\x1f`).
- Multiple-space runs (`"  Two  Spaces  "`).
- Leading/trailing whitespace and periods.
- Non-ASCII / accents preserved (`Léon Tolstoï`).

### `app/services/book-store.test.ts` (extend)

- `addBook` moves a staged file to `<booksDir>/<id>.epub`; the staged file no
  longer exists.
- `addBook` throws `BookAlreadyExistsError` when the row already exists.
- `reimportBook` with metadata change that alters the hash renames the file on
  disk; the old `<id>.epub` no longer exists, the new one does.
- `reimportBook` collision (new id already in DB) throws and leaves both files
  in their original places.
- `scan` renames a non-canonically-named EPUB it finds in `booksDir` to
  `<id>.epub` before importing.
- `getBookById` returns `filename` equal to `downloadFilename(book)` and `path`
  equal to `<booksDir>/<id>.epub`.
- Migration v7: seed a fresh test DB at `user_version = 6` with a row
  containing `filename = 'arbitrary.epub'` and a matching file on disk, run
  migration, assert file is renamed and columns are gone.

### `app/routes/ui.test.ts` (extend)

- Upload of a duplicate (same content twice) returns `409` with the
  duplicate-message error and leaves the existing book untouched.
- Upload that succeeds places the file at `<booksDir>/<id>.epub` (assert via
  the books-dir listing).

### `app/routes/opds.test.ts` (extend)

- Download `Content-Disposition` header contains the computed download name
  (e.g. assert it ends in `-The_Fellowship_of_the_Ring.epub`), not the hash.

## Files changed / created

| Path | Change |
|---|---|
| `app/utils/download-filename.ts` | New utility. |
| `app/utils/download-filename.test.ts` | New tests. |
| `app/types.ts` | `Book.filename` doc comment; no shape change. |
| `app/services/book-store.ts` | Schema migration v7; `addBook` signature; rename on `reimportBook`; rename on `scan`; new `BookAlreadyExistsError`; `rowToBook` computes filename and path. |
| `app/services/book-store.test.ts` | New + extended cases. |
| `app/routes/ui.ts` | Multer staging dir; 409 returned on duplicate-fingerprint uploads. |
| `app/routes/ui.test.ts` | Tests for new error shape. |
| `app/routes/opds.test.ts` | Updated download-disposition assertion. |

## Out of scope

- Changing how progress, kosync, or any other API references books — those use
  `book.id` and are unaffected.
- Frontend changes beyond surfacing per-file errors already covered by the
  existing upload-queue UI (which already has an `error` state per item).
- Persisting the original filename anywhere; the original name is discarded on
  successful import.

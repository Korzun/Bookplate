# Book Filename Canonicalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every book in the library live at `<booksDir>/<id>.epub` on disk and serve downloads with a name derived from `[author]-[series]-[index]-[title].epub`.

**Architecture:** A new pure utility (`downloadFilename`) produces the user-facing name from a book's metadata. `BookStore` becomes the sole owner of the on-disk path, computing it from `id`. The `books` table loses its `filename` and `path` columns (schema migration v7, table rebuild because `filename` has a `UNIQUE` index). Uploads stage into `<booksDir>/.staging/`, then `BookStore.addBook` moves the staged file into its canonical location. Metadata edits, library scans, and the migration each enforce the same `<id>.epub` invariant by renaming any file that's out of place.

**Tech Stack:** TypeScript, Express, better-sqlite3, Multer, Jest, Supertest.

---

## File Structure

| Path | Role | Created/Modified |
|---|---|---|
| `app/utils/download-filename.ts` | Pure utility that turns `{author, series, seriesIndex, title}` into the download filename. | Create |
| `app/utils/download-filename.test.ts` | Unit tests for the utility. | Create |
| `app/types.ts` | `Book.filename` documentation comment updated to describe its new meaning. | Modify |
| `app/services/book-store.ts` | `BookAlreadyExistsError`; `rowToBook` computes `filename`/`path`; `addBook` signature changes and moves files; `reimportBook` renames on hash change; `scan` canonicalizes files; v7 migration rebuilds the table and renames files. | Modify |
| `app/services/book-store.test.ts` | Existing call sites updated; new tests for the new behavior. | Modify |
| `app/routes/ui.ts` | Multer stages into `<booksDir>/.staging/`; upload handler calls new `addBook` signature; 409 on duplicate; ensures non-empty title fallback. | Modify |
| `app/routes/ui.test.ts` | New tests for staging behavior, 409 on duplicate, fallback title. | Modify |
| `app/routes/opds.test.ts` | Assert `Content-Disposition` contains the computed download name. | Modify |

---

## Task 1: `downloadFilename` utility (TDD)

**Files:**
- Create: `app/utils/download-filename.ts`
- Create: `app/utils/download-filename.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `app/utils/download-filename.test.ts` with:

```typescript
import { downloadFilename } from './download-filename';

describe('downloadFilename', () => {
  it('formats a book with a series', () => {
    expect(
      downloadFilename({
        author: 'J.R.R. Tolkien',
        series: 'The Lord of the Rings',
        seriesIndex: 1,
        title: 'The Fellowship of the Ring',
      })
    ).toBe('J.R.R._Tolkien-The_Lord_of_the_Rings-1-The_Fellowship_of_the_Ring.epub');
  });

  it('formats a standalone (no series)', () => {
    expect(
      downloadFilename({
        author: 'Frank Herbert',
        series: '',
        seriesIndex: 0,
        title: 'Dune',
      })
    ).toBe('Frank_Herbert-Dune.epub');
  });

  it('renders fractional series index with underscore', () => {
    expect(
      downloadFilename({
        author: 'Brandon Sanderson',
        series: 'Stormlight Archive',
        seriesIndex: 1.5,
        title: 'Edgedancer',
      })
    ).toBe('Brandon_Sanderson-Stormlight_Archive-1_5-Edgedancer.epub');
  });

  it('drops trailing zeros on integer-valued floats', () => {
    expect(
      downloadFilename({
        author: 'A',
        series: 'S',
        seriesIndex: 2.0,
        title: 'T',
      })
    ).toBe('A-S-2-T.epub');
  });

  it('emits index of 0 when series is present but index is 0', () => {
    expect(
      downloadFilename({
        author: 'A',
        series: 'S',
        seriesIndex: 0,
        title: 'T',
      })
    ).toBe('A-S-0-T.epub');
  });

  it('substitutes Unknown for empty author', () => {
    expect(
      downloadFilename({ author: '', series: '', seriesIndex: 0, title: 'Dune' })
    ).toBe('Unknown-Dune.epub');
  });

  it('substitutes Unknown for empty title', () => {
    expect(
      downloadFilename({ author: 'Frank Herbert', series: '', seriesIndex: 0, title: '' })
    ).toBe('Frank_Herbert-Unknown.epub');
  });

  it('substitutes Unknown when both author and title are empty', () => {
    expect(
      downloadFilename({ author: '', series: '', seriesIndex: 0, title: '' })
    ).toBe('Unknown-Unknown.epub');
  });

  it('treats blank series as absent', () => {
    expect(
      downloadFilename({ author: 'A', series: '   ', seriesIndex: 3, title: 'T' })
    ).toBe('A-T.epub');
  });

  it('strips filesystem-illegal characters', () => {
    expect(
      downloadFilename({
        author: 'Sue / Bob',
        series: '',
        seriesIndex: 0,
        title: 'Path: A * Memoir? "Final" <draft> | v1',
      })
    ).toBe('Sue_Bob-Path_A_Memoir_Final_draft_v1.epub');
  });

  it('strips control characters', () => {
    expect(
      downloadFilename({
        author: 'A\x00B\x1fC',
        series: '',
        seriesIndex: 0,
        title: 'Title',
      })
    ).toBe('ABC-Title.epub');
  });

  it('collapses whitespace runs to a single underscore', () => {
    expect(
      downloadFilename({
        author: '  Two   Spaces  ',
        series: '',
        seriesIndex: 0,
        title: 'Some\tTabbed\t Title',
      })
    ).toBe('Two_Spaces-Some_Tabbed_Title.epub');
  });

  it('strips leading/trailing underscores and periods', () => {
    expect(
      downloadFilename({
        author: '..A..',
        series: '',
        seriesIndex: 0,
        title: '__T__',
      })
    ).toBe('A-T.epub');
  });

  it('preserves non-ASCII characters', () => {
    expect(
      downloadFilename({
        author: 'Léon Tolstoï',
        series: '',
        seriesIndex: 0,
        title: 'Война и мир',
      })
    ).toBe('Léon_Tolstoï-Война_и_мир.epub');
  });

  it('falls back to Unknown when sanitization empties a required field', () => {
    expect(
      downloadFilename({ author: '////', series: '', seriesIndex: 0, title: '////' })
    ).toBe('Unknown-Unknown.epub');
  });

  it('drops the series segment when the series sanitizes to empty', () => {
    expect(
      downloadFilename({ author: 'A', series: '////', seriesIndex: 3, title: 'T' })
    ).toBe('A-T.epub');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest app/utils/download-filename.test.ts`
Expected: FAIL — `Cannot find module './download-filename'`.

- [ ] **Step 3: Write the utility**

Create `app/utils/download-filename.ts`:

```typescript
const ILLEGAL_FS_CHARS = /[/\\:*?"<>|]/g;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;
const WHITESPACE_RUN = /\s+/g;
const LEADING_TRAILING = /^[_.]+|[_.]+$/g;

function sanitizeField(input: string): string {
  return input
    .replace(CONTROL_CHARS, '')
    .replace(ILLEGAL_FS_CHARS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
    .replace(/ /g, '_')
    .replace(LEADING_TRAILING, '');
}

function formatSeriesIndex(n: number): string {
  return Number(n).toString().replace('.', '_');
}

export function downloadFilename(book: {
  author: string;
  series: string;
  seriesIndex: number;
  title: string;
}): string {
  const author = sanitizeField(book.author.trim()) || 'Unknown';
  const title = sanitizeField(book.title.trim()) || 'Unknown';
  const series = sanitizeField(book.series.trim());

  if (series === '') {
    return `${author}-${title}.epub`;
  }

  const index = sanitizeField(formatSeriesIndex(book.seriesIndex));
  return `${author}-${series}-${index}-${title}.epub`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest app/utils/download-filename.test.ts`
Expected: PASS — all 15 tests green.

- [ ] **Step 5: Commit**

```bash
git add app/utils/download-filename.ts app/utils/download-filename.test.ts
git commit -m "feat: add downloadFilename utility for user-facing book names"
```

---

## Task 2: Document `Book.filename` and add `BookAlreadyExistsError`

**Files:**
- Modify: `app/types.ts`
- Modify: `app/services/book-store.ts`

- [ ] **Step 1: Update `Book.filename` doc comment**

In `app/types.ts`, replace the `filename` line in the `Book` interface (currently `filename: string;`) with:

```typescript
  /**
   * User-facing download name derived from metadata
   * ([author]-[series]-[index]-[title].epub). NOT the on-disk filename — every
   * book is stored as `<id>.epub`.
   */
  filename: string;
  /** Absolute on-disk path: `<booksDir>/<id>.epub`. */
  path: string;
```

(The `path` line already exists immediately after; replace both with the documented versions.)

- [ ] **Step 2: Add `BookAlreadyExistsError` to `book-store.ts`**

In `app/services/book-store.ts`, immediately after the existing `BookHashCollisionError` class (around line 15), add:

```typescript
export class BookAlreadyExistsError extends Error {
  constructor(public readonly existingId: string) {
    super(`Book with id "${existingId}" already exists in the library`);
    this.name = 'BookAlreadyExistsError';
  }
}
```

- [ ] **Step 3: Run lint to confirm both files still compile**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add app/types.ts app/services/book-store.ts
git commit -m "feat: document Book.filename meaning and add BookAlreadyExistsError"
```

---

## Task 3: Compute `filename` and `path` in `rowToBook` from `id`

This task changes how `BookStore` reads books out of the DB: `filename` becomes the result of `downloadFilename(book)`, and `path` becomes `path.join(booksDir, id + '.epub')`. The DB columns still exist (they're rebuilt away in Task 7), they're just no longer read.

**Files:**
- Modify: `app/services/book-store.ts`
- Modify: `app/services/book-store.test.ts`

- [ ] **Step 1: Write a failing test that `book.filename` is the computed download name**

In `app/services/book-store.test.ts`, inside the existing `describe('addBook and listBooks', () => { ... })`, add:

```typescript
  it('exposes book.filename as the computed download name', () => {
    bookStore.addBook(
      'fname-1',
      'whatever-on-disk.epub',
      path.join(booksDir, 'whatever-on-disk.epub'),
      100,
      new Date(),
      { ...FAKE_META, author: 'Frank Herbert', series: '', seriesIndex: 0, title: 'Dune' }
    );
    const book = bookStore.getBookById('fname-1');
    expect(book!.filename).toBe('Frank_Herbert-Dune.epub');
  });

  it('exposes book.path as <booksDir>/<id>.epub regardless of stored path', () => {
    bookStore.addBook(
      'path-1',
      'on-disk.epub',
      path.join(booksDir, 'on-disk.epub'),
      100,
      new Date(),
      FAKE_META
    );
    const book = bookStore.getBookById('path-1');
    expect(book!.path).toBe(path.join(booksDir, 'path-1.epub'));
  });
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run: `npx jest app/services/book-store.test.ts -t 'exposes book.filename'`
Run: `npx jest app/services/book-store.test.ts -t 'exposes book.path'`
Expected: Both FAIL — current behavior returns the stored filename and path verbatim.

- [ ] **Step 3: Update `rowToBook` to compute `filename` and `path`**

In `app/services/book-store.ts`:

a) At the top, add the utility import (after the existing imports):

```typescript
import { downloadFilename } from '../utils/download-filename';
```

b) Replace the `BookRow` interface (currently has `filename` and `path` fields) with:

```typescript
interface BookRow {
  id: string;
  title: string;
  file_as: string;
  author: string;
  description: string;
  publisher: string;
  series: string;
  series_index: number;
  identifiers: string; // JSON string
  subjects: string; // JSON string
  has_cover: number;
  chapter_count: number;
  chapter_spine_map: string;
  chapter_names: string | null;
  size: number;
  mtime: number;
  added_at: number;
}
```

c) Replace `rowToBook` (currently returns `filename: r.filename, path: r.path, ...`) with:

```typescript
  private rowToBook(r: BookRow): Book {
    const fileAs = r.file_as;
    return {
      id: r.id,
      filename: downloadFilename({
        author: r.author,
        series: r.series,
        seriesIndex: r.series_index,
        title: r.title,
      }),
      path: path.join(this.booksDir, r.id + '.epub'),
      title: r.title,
      fileAs,
      author: r.author,
      description: r.description,
      publisher: r.publisher,
      series: r.series,
      seriesIndex: r.series_index,
      identifiers: JSON.parse(r.identifiers) as { scheme: string; value: string }[],
      subjects: JSON.parse(r.subjects) as string[],
      hasCover: Boolean(r.has_cover),
      size: r.size,
      mtime: new Date(r.mtime),
      addedAt: new Date(r.added_at),
      chapterCount: r.chapter_count,
      chapterSpineMap: JSON.parse(r.chapter_spine_map) as number[],
      chapterNames: r.chapter_names ? (JSON.parse(r.chapter_names) as string[]) : [],
    };
  }
```

d) Update the `SELECT` lists in `listBooks` and `getBookById` to no longer fetch `filename` or `path` (they're not in `BookRow` anymore). Replace the `listBooks` query body with:

```typescript
      SELECT id, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map, chapter_names
      FROM books
      ORDER BY CASE WHEN file_as != '' THEN file_as ELSE title END, title, id
```

And `getBookById`'s query body with:

```typescript
      SELECT id, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map, chapter_names
      FROM books WHERE id = ?
```

(Note the `ORDER BY` tiebreaker switched from `filename` to `id` — `filename` is no longer in the row.)

- [ ] **Step 4: Run the focused tests to confirm they pass**

Run: `npx jest app/services/book-store.test.ts -t 'exposes book.filename'`
Run: `npx jest app/services/book-store.test.ts -t 'exposes book.path'`
Expected: PASS.

- [ ] **Step 5: Repair existing tests that asserted the old `book.filename` value**

Two tests assert specific filename values that change once `book.filename` is computed from metadata. Update them so the suite stays green at the end of this task.

In `app/services/book-store.test.ts`:

a) `describe('getBookById')` → `it('returns the book by id', ...)` — currently:

```typescript
expect(book!.filename).toBe('mybook.epub');
```

Replace with:

```typescript
expect(book!.filename).toBe('Author_Name-Test_Series-1-Test_Book.epub');
```

(Derived from `FAKE_META`: author `Author Name`, series `Test Series`, seriesIndex `1`, title `Test Book`.)

b) Inside `describe('BookStore.scan()')` → `it('imports an epub found on disk but not in DB', ...)` — currently:

```typescript
expect(books[0].filename).toBe('new-book.epub');
```

Replace with an assertion based on whatever `makeMockImporter().parseEpub` returns. If it returns `{ ...FAKE_META, title: 'Mock Title' }`, the computed filename is `Author_Name-Test_Series-1-Mock_Title.epub`. Read the body of `makeMockImporter` (around line 266) to confirm, then write the matching assertion. If the existing test asserts both `filename` and `title`, prefer keeping the `title` assertion and dropping the `filename` one (the title is the more informative invariant).

- [ ] **Step 6: Run the entire book-store test file**

Run: `npx jest app/services/book-store.test.ts`
Expected: PASS. If any other test that asserts `book.filename` is `<something>.epub` still fails, repeat the pattern above — find it, recompute the expected value from `downloadFilename`, update the assertion.

- [ ] **Step 7: Commit**

```bash
git add app/services/book-store.ts app/services/book-store.test.ts
git commit -m "refactor: compute Book.filename and Book.path from id"
```

---

## Task 4: New `addBook` signature — moves staged file, rejects duplicates

`addBook` will: take `(id, srcPath, meta)` (no separate `filename`/`size`/`mtime` arguments), `stat` the source file itself, move the staged file to `<booksDir>/<id>.epub` (no-op if already at target), and throw `BookAlreadyExistsError` when the row exists. The `filename` and `path` DB columns are still in the schema, so the `INSERT` writes them as `<id>.epub` and `<booksDir>/<id>.epub` respectively to satisfy `NOT NULL UNIQUE`. Those columns disappear entirely in Task 7.

The old "title falls back to filename stem" behavior moves out of `addBook` — callers (the upload route and `scan`) supply a fallback themselves before calling.

**Files:**
- Modify: `app/services/book-store.ts`
- Modify: `app/services/book-store.test.ts`

- [ ] **Step 1: Write the failing tests**

In `app/services/book-store.test.ts`:

a) Replace the existing `'upserts on same filename'` test (it's testing behavior we're removing) with:

```typescript
  it('throws BookAlreadyExistsError when adding a book whose id is already in the DB', async () => {
    const aPath = path.join(booksDir, 'a.epub');
    const bPath = path.join(booksDir, 'b.epub');
    fs.writeFileSync(aPath, 'first');
    fs.writeFileSync(bPath, 'second');
    bookStore.addBook('same-id', aPath, FAKE_META);
    expect(() => bookStore.addBook('same-id', bPath, FAKE_META)).toThrow(
      'Book with id "same-id" already exists',
    );
  });
```

b) Add tests for the move behavior, in the same describe block:

```typescript
  it('moves the source file to <booksDir>/<id>.epub', () => {
    const stagedPath = path.join(booksDir, 'staged.epub');
    fs.writeFileSync(stagedPath, 'content');
    bookStore.addBook('move-id', stagedPath, FAKE_META);
    expect(fs.existsSync(stagedPath)).toBe(false);
    expect(fs.existsSync(path.join(booksDir, 'move-id.epub'))).toBe(true);
  });

  it('is a no-op for the file when source is already at <id>.epub', () => {
    const canonical = path.join(booksDir, 'noop-id.epub');
    fs.writeFileSync(canonical, 'content');
    bookStore.addBook('noop-id', canonical, FAKE_META);
    expect(fs.existsSync(canonical)).toBe(true);
    expect(fs.readFileSync(canonical, 'utf8')).toBe('content');
  });

  it('records size and mtime by stat-ing the source file', () => {
    const stagedPath = path.join(booksDir, 'sized.epub');
    fs.writeFileSync(stagedPath, '0123456789');
    bookStore.addBook('size-id', stagedPath, FAKE_META);
    const book = bookStore.getBookById('size-id');
    expect(book!.size).toBe(10);
    // mtime should be roughly "now"; allow a generous skew
    expect(Math.abs(book!.mtime.getTime() - Date.now())).toBeLessThan(5000);
  });
```

c) Delete the existing test `'uses filename stem as title fallback when title is empty'` — that fallback moves to the upload route (covered in Task 8). Empty titles now flow through to the DB and are handled by `downloadFilename`.

d) Update every existing call to `bookStore.addBook(...)` in `book-store.test.ts` to the new signature `(id, srcPath, meta)`. Most existing calls pass a fake path like `'/books/foo.epub'` that doesn't exist — those need to be changed to write a real file inside `booksDir` first. There are roughly 15 such call sites across the file. The mechanical rewrite for each looks like:

Before:
```typescript
bookStore.addBook('abc123', 'test.epub', '/books/test.epub', 1000, new Date(1000), FAKE_META);
```

After:
```typescript
const p = path.join(booksDir, 'staged-abc123.epub');
fs.writeFileSync(p, 'x');
bookStore.addBook('abc123', p, FAKE_META);
```

To reduce repetition, add this helper near the top of the file (just below `FAKE_META`):

```typescript
function stage(id: string, content = 'x'): string {
  const p = path.join(booksDir, `staged-${id}.epub`);
  fs.writeFileSync(p, content);
  return p;
}
```

Then call sites become e.g. `bookStore.addBook('abc123', stage('abc123'), FAKE_META);`.

Tests that asserted specific `mtime` values (e.g. `new Date(1000)`) need their assertions relaxed — mtime now comes from `fs.statSync` and reflects "right now". Search the file for any assertions of the form `expect(...mtime...).toBe(...)` or `.toEqual(new Date(1000))` and either remove them or replace them with a recency check.

Similarly for `size`: assertions that pin a specific `size` value need to either write a file of that size (`fs.writeFileSync(stagedPath, 'a'.repeat(1000))`) or drop the assertion.

Mechanically: run the full test file after editing and let the remaining failures guide which assertions still need fixing.

- [ ] **Step 2: Verify tests fail in the expected way**

Run: `npx jest app/services/book-store.test.ts`
Expected: At least the `BookAlreadyExistsError` and "moves source file" tests fail because `addBook`'s implementation hasn't changed yet. Many of the rewritten call sites will also fail to compile because they pass too few arguments — this is the type-checker telling us where to update the implementation next.

- [ ] **Step 3: Update `addBook` in `app/services/book-store.ts`**

Replace the entire `addBook` method body. Current signature is:

```typescript
addBook(
  id: string,
  filename: string,
  filePath: string,
  size: number,
  mtime: Date,
  meta: EpubMeta
): void
```

Replace with:

```typescript
addBook(id: string, srcPath: string, meta: EpubMeta): void {
  const existing = this.db.prepare('SELECT 1 FROM books WHERE id = ?').get(id);
  if (existing) {
    throw new BookAlreadyExistsError(id);
  }

  const targetPath = path.join(this.booksDir, id + '.epub');
  if (path.resolve(srcPath) !== path.resolve(targetPath)) {
    fs.renameSync(srcPath, targetPath);
  }

  const stat = fs.statSync(targetPath);
  const filename = id + '.epub';
  const title = meta.title.trim();
  const fileAs = (meta.fileAs || '').trim();

  this.db
    .prepare(
      `
      INSERT INTO books (id, filename, path, title, file_as, author, description, publisher,
                         series, series_index, identifiers, subjects, cover_data, cover_mime,
                         size, mtime, added_at, chapter_count, chapter_spine_map, chapter_names)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      id,
      filename,
      targetPath,
      title,
      fileAs,
      meta.author,
      meta.description,
      meta.publisher,
      meta.series,
      meta.seriesIndex,
      JSON.stringify(meta.identifiers),
      JSON.stringify(meta.subjects),
      meta.coverData,
      meta.coverMime,
      stat.size,
      stat.mtimeMs,
      Date.now(),
      meta.chapterCount,
      JSON.stringify(meta.chapterSpineMap),
      JSON.stringify(meta.chapterNames)
    );
}
```

Notes on the rewrite:
- `ON CONFLICT(filename) DO UPDATE` is gone — duplicate handling is explicit, via the up-front `SELECT 1` check.
- The title-stem fallback (`path.basename(filename, path.extname(filename))`) is dropped — callers (the upload route and `scan`) now supply a fallback before calling. The test `'uses filename stem as title fallback when title is empty'` was deleted in step 1c above; that behavior moves to the upload route (Task 8).
- `filename` and `path` columns still receive values to satisfy the `NOT NULL UNIQUE` schema; Task 7 drops them.

- [ ] **Step 4: Run the full book-store test file**

Run: `npx jest app/services/book-store.test.ts`
Expected: All tests in this file pass.

If a few unrelated tests still fail, they are likely tests in the `scan` or `reimportBook` blocks that depend on the old `addBook` signature being called internally. Those internal call sites are updated next.

- [ ] **Step 5: Update internal `addBook` callers in `book-store.ts`**

a) In `scan()`, the call site currently reads:

```typescript
this.addBook(id, filename, filePath, stat.size, stat.mtime, meta);
```

Change it to first ensure a non-empty title (preserving the old fallback behavior at the caller layer) and then call the new signature:

```typescript
const titleFallback = meta.title.trim() || path.basename(filename, path.extname(filename));
this.addBook(id, filePath, { ...meta, title: titleFallback });
```

b) `reimportBook` doesn't call `addBook` — leave it for Task 5.

- [ ] **Step 6: Re-run the full book-store test file**

Run: `npx jest app/services/book-store.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/services/book-store.ts app/services/book-store.test.ts
git commit -m "feat: BookStore.addBook moves staged file and rejects duplicates"
```

---

## Task 5: `reimportBook` renames file when hash changes

When a metadata edit changes the content hash, the file on disk must be renamed from `<oldId>.epub` to `<newId>.epub`. The rename happens inside the existing transaction so that a failure rolls back the DB update too. If a file already exists at the new path with different content, `fs.renameSync` will overwrite it — to avoid that we explicitly check.

**Files:**
- Modify: `app/services/book-store.ts`
- Modify: `app/services/book-store.test.ts`

- [ ] **Step 1: Write the failing test**

In `app/services/book-store.test.ts`, find the existing `describe('reimportBook', ...)` block and add:

```typescript
  it('renames file on disk from <oldId>.epub to <newId>.epub when hash changes', () => {
    const oldId = 'old-id-aaaa';
    const oldPath = path.join(booksDir, oldId + '.epub');
    fs.writeFileSync(oldPath, makeMinimalEpub('Title'));
    bookStore.addBook(oldId, oldPath, FAKE_META);

    const newId = 'new-id-bbbb';
    const mockImporter: ScanImporter = {
      parseEpub: () => ({ ...FAKE_META, title: 'New Title' }),
      partialMD5: () => newId,
    };
    bookStore.reimportBook(oldId, mockImporter);

    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(path.join(booksDir, newId + '.epub'))).toBe(true);
  });

  it('does not rename when hash is unchanged', () => {
    const id = 'stable-id';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, makeMinimalEpub('Title'));
    bookStore.addBook(id, filePath, FAKE_META);

    const mockImporter: ScanImporter = {
      parseEpub: () => ({ ...FAKE_META, title: 'Edited' }),
      partialMD5: () => id,
    };
    bookStore.reimportBook(id, mockImporter);

    expect(fs.existsSync(filePath)).toBe(true);
  });
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run: `npx jest app/services/book-store.test.ts -t 'renames file on disk'`
Expected: FAIL — the file at `<oldId>.epub` is not renamed today.

- [ ] **Step 3: Implement the rename**

In `app/services/book-store.ts`, locate the start of the transaction inside `reimportBook` (the line that starts `this.db.transaction(() => {`). Inside the `if (newId !== id) {` branch, before the existing `this.db.prepare(...)` UPDATE statement, add the on-disk rename:

```typescript
        const oldPath = path.join(this.booksDir, id + '.epub');
        const newPath = path.join(this.booksDir, newId + '.epub');
        if (oldPath !== newPath) {
          fs.renameSync(oldPath, newPath);
        }
```

(`oldPath` is constructed from the in-memory `id`, not the DB `path` column, so it's correct regardless of whether the legacy `path` column is still being read elsewhere.)

Also delete the existing `path.basename(row.filename, ...)` title-fallback expression in the same UPDATE statement (and the parallel one in the `else` branch). The fallback is now applied by callers (see Task 4 step 5 for the same pattern in `scan`). Replace both occurrences of:

```typescript
meta.title.trim() || path.basename(row.filename, path.extname(row.filename)),
```

with simply:

```typescript
meta.title.trim(),
```

`reimportBook` reads `path, filename` from its own SQL query (not via `rowToBook`), so the substitution above forces a corresponding rewrite of that query. Currently:

```typescript
const row = this.db.prepare('SELECT path, filename FROM books WHERE id = ?').get(id) as
  | { path: string; filename: string }
  | undefined;
```

Replace with:

```typescript
const row = this.db.prepare('SELECT 1 FROM books WHERE id = ?').get(id);
```

And below, replace any reference to `row.path` with `path.join(this.booksDir, id + '.epub')`, and any reference to `row.filename` with `id + '.epub'`.

- [ ] **Step 4: Re-run the file-rename tests**

Run: `npx jest app/services/book-store.test.ts -t 'renames file on disk'`
Run: `npx jest app/services/book-store.test.ts -t 'does not rename when hash is unchanged'`
Expected: PASS.

- [ ] **Step 5: Re-run the full book-store test file**

Run: `npx jest app/services/book-store.test.ts`
Expected: PASS — existing reimport tests (including the hash-collision test) should still work because the rename only runs when `newId !== id` AND comes before the DB update inside the transaction.

- [ ] **Step 6: Commit**

```bash
git add app/services/book-store.ts app/services/book-store.test.ts
git commit -m "feat: reimportBook renames file on disk when hash changes"
```

---

## Task 6: `scan()` canonicalizes on-disk filenames

`scan` walks `<booksDir>` for `*.epub`. For each file:

1. If the filename is already `<id>.epub` for some `id` in the DB, skip (fast path — no MD5).
2. Otherwise compute `partialMD5(file)`.
3. If the file isn't named `<id>.epub`, rename it (skip with a warning if a different file already occupies the canonical name).
4. If the row already exists in the DB, skip (the rename in step 3 was the only thing to do).
5. Otherwise import via `addBook`.

Stale-row detection (rows whose file no longer exists on disk) continues to work because `path` is computed from `id`.

**Files:**
- Modify: `app/services/book-store.ts`
- Modify: `app/services/book-store.test.ts`

- [ ] **Step 1: Write the failing test**

In `app/services/book-store.test.ts`, inside `describe('BookStore.scan()', ...)`, add:

```typescript
  it('renames a non-canonically-named file to <id>.epub before importing', () => {
    const arbitraryPath = path.join(booksDir, 'arbitrary-name.epub');
    fs.writeFileSync(arbitraryPath, makeMinimalEpub('A Book'));
    const importer = makeMockImporter();
    const result = bookStore.scan(importer);
    expect(result.imported).toContain('arbitrary-name.epub');
    expect(fs.existsSync(arbitraryPath)).toBe(false);
    const books = bookStore.listBooks();
    expect(books).toHaveLength(1);
    const expectedPath = path.join(booksDir, books[0].id + '.epub');
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it('removes rows whose canonical file is missing', () => {
    // Seed a book at <id>.epub, then delete the file from disk.
    const id = 'orphan-id';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, makeMinimalEpub('To Delete'));
    bookStore.addBook(id, filePath, FAKE_META);
    fs.unlinkSync(filePath);

    const result = bookStore.scan(makeMockImporter());
    expect(result.removed).toContain(id + '.epub');
    expect(bookStore.getBookById(id)).toBeNull();
  });
```

You may need to inspect `makeMockImporter` (already defined in the test file) — make sure its `partialMD5` returns a value derived from the file path or its content so different files get distinct ids in tests. If it's a fixed value, adjust to return a distinct id per call (e.g. by hashing the path).

- [ ] **Step 2: Verify the tests fail**

Run: `npx jest app/services/book-store.test.ts -t 'renames a non-canonically-named file'`
Run: `npx jest app/services/book-store.test.ts -t 'removes rows whose canonical file is missing'`
Expected: FAIL.

- [ ] **Step 3: Replace `scan()` in `book-store.ts`**

Replace the current `scan()` body with:

```typescript
scan(importer: ScanImporter = defaultImporter): { imported: string[]; removed: string[] } {
  const imported: string[] = [];
  const removed: string[] = [];

  const dbIds = new Set(this.listBooks().map((b) => b.id));

  const diskFilenames: string[] = fs.existsSync(this.booksDir)
    ? fs
        .readdirSync(this.booksDir)
        .filter((f) => path.extname(f).toLowerCase() === '.epub')
    : [];

  for (const filename of diskFilenames) {
    const filePath = path.join(this.booksDir, filename);
    const stem = path.basename(filename, '.epub');

    // Fast path: file already at <id>.epub and that id is imported.
    if (/^[0-9a-f]{32}$/.test(stem) && dbIds.has(stem)) {
      continue;
    }

    let id: string;
    let meta: EpubMeta;
    try {
      id = importer.partialMD5(filePath);
      meta = importer.parseEpub(filePath);
    } catch (err: unknown) {
      log.warn(
        `scan: skipping "${filename}" — ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    const canonicalPath = path.join(this.booksDir, id + '.epub');
    if (filePath !== canonicalPath) {
      if (fs.existsSync(canonicalPath)) {
        log.warn(
          `scan: skipping "${filename}" — canonical path ${id}.epub already occupied`
        );
        continue;
      }
      fs.renameSync(filePath, canonicalPath);
    }

    if (dbIds.has(id)) {
      // Rename above was the only thing to do.
      continue;
    }

    try {
      const titleFallback = meta.title.trim() || path.basename(filename, path.extname(filename));
      this.addBook(id, canonicalPath, { ...meta, title: titleFallback });
      dbIds.add(id);
      imported.push(filename);
    } catch (err: unknown) {
      log.warn(
        `scan: skipping "${filename}" — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Stale rows: in DB but their canonical file is missing.
  for (const book of this.listBooks()) {
    const canonicalPath = path.join(this.booksDir, book.id + '.epub');
    if (!fs.existsSync(canonicalPath)) {
      this.removeStaleBook(book.id);
      removed.push(book.id + '.epub');
    }
  }

  return { imported, removed };
}
```

Notes:
- The "fast path" avoids reading the file when its name already encodes the id.
- The "stale rows" detection now uses computed canonical paths, not `book.filename`.
- The pushed value for `removed` is `<id>.epub` (the canonical name we expected). Earlier tests in this file may expect `book.filename`; they need to be reviewed in step 4.

- [ ] **Step 4: Run the full book-store test suite and repair existing scan tests**

Run: `npx jest app/services/book-store.test.ts`

The existing `describe('BookStore.scan()')` block has several tests that:
- Assert specific filenames in `imported` / `removed` arrays.
- Build files with arbitrary names via `fs.writeFileSync(path.join(booksDir, 'foo.epub'), ...)` and expect `imported` to contain `'foo.epub'`.

For tests that wrote arbitrary names and expected them imported, the new behavior renames them — and `imported` is intentionally still the original filename (because that's the user-facing fact: *this* file was imported). So most existing assertions still work as-is. Any test that checks `book.filename === 'foo.epub'` post-scan needs updating, because `book.filename` is now the computed download name. Replace those with checks against `book.title` or `book.id`.

For tests that expected `removed` to contain a specific filename: change them to `removed.toContain(<id>.epub)` or, if the test was previously using a row inserted via `addBook` with a bogus path, replace with the new pattern (write a real file at `<id>.epub`, then unlink it).

- [ ] **Step 5: Confirm the suite is green**

Run: `npx jest app/services/book-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/services/book-store.ts app/services/book-store.test.ts
git commit -m "feat: scan canonicalizes filenames to <id>.epub"
```

---

## Task 7: Schema migration v7 — rebuild table without `filename`/`path` columns

The current schema has `filename TEXT NOT NULL UNIQUE` and `path TEXT NOT NULL`. Because `filename` has a `UNIQUE` index, SQLite can't `ALTER TABLE ... DROP COLUMN` it (per SQLite docs). We rebuild the table.

Migration also normalizes any out-of-place files on disk by renaming them to `<id>.epub`.

**Files:**
- Modify: `app/services/book-store.ts`
- Modify: `app/services/book-store.test.ts`

- [ ] **Step 1: Write the failing migration test**

In `app/services/book-store.test.ts`, add a new top-level describe block:

```typescript
describe('migration v7 (drop filename/path columns and canonicalize on-disk names)', () => {
  it('renames files to <id>.epub and rebuilds the books table', () => {
    // Build a fresh DB at user_version = 6 with the old schema shape.
    const dbPath = path.join(booksDir, 'mig.sqlite');
    const seedDb = new Database(dbPath);
    seedDb.exec(`
      CREATE TABLE books (
        id            TEXT    PRIMARY KEY,
        filename      TEXT    NOT NULL UNIQUE,
        path          TEXT    NOT NULL,
        title         TEXT    NOT NULL,
        file_as       TEXT    NOT NULL DEFAULT '',
        author        TEXT    NOT NULL DEFAULT '',
        description   TEXT    NOT NULL DEFAULT '',
        publisher     TEXT    NOT NULL DEFAULT '',
        series        TEXT    NOT NULL DEFAULT '',
        series_index  REAL    NOT NULL DEFAULT 0,
        identifiers   TEXT    NOT NULL DEFAULT '[]',
        subjects      TEXT    NOT NULL DEFAULT '[]',
        cover_data    BLOB,
        cover_mime    TEXT,
        size          INTEGER NOT NULL,
        mtime         INTEGER NOT NULL,
        added_at      INTEGER NOT NULL,
        chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]',
        chapter_names TEXT
      );
      CREATE TABLE book_thumbnails (
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE ON UPDATE CASCADE,
        width   INTEGER NOT NULL,
        data    BLOB NOT NULL,
        mime    TEXT NOT NULL,
        PRIMARY KEY (book_id, width)
      );
      PRAGMA user_version = 6;
    `);

    // Write a real file under the OLD arbitrary name.
    const oldOnDisk = path.join(booksDir, 'arbitrary.epub');
    fs.writeFileSync(oldOnDisk, 'content');

    seedDb
      .prepare(
        `INSERT INTO books (id, filename, path, title, size, mtime, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('book-id-1', 'arbitrary.epub', oldOnDisk, 'A Book', 7, 0, 0);
    seedDb.close();

    // Open via BookStore — triggers migration.
    const realDb = new Database(dbPath);
    const store = new BookStore(booksDir, realDb);

    // File renamed.
    expect(fs.existsSync(oldOnDisk)).toBe(false);
    expect(fs.existsSync(path.join(booksDir, 'book-id-1.epub'))).toBe(true);

    // Row still queryable.
    const book = store.getBookById('book-id-1');
    expect(book!.title).toBe('A Book');

    // Columns are gone.
    const cols = realDb.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain('filename');
    expect(colNames).not.toContain('path');

    // user_version bumped.
    const { user_version: uv } = realDb.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    expect(uv).toBeGreaterThanOrEqual(7);

    realDb.close();
  });

  it('logs and skips rows whose on-disk file is missing', () => {
    const dbPath = path.join(booksDir, 'missing.sqlite');
    const seedDb = new Database(dbPath);
    seedDb.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        file_as TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        publisher TEXT NOT NULL DEFAULT '',
        series TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0,
        identifiers TEXT NOT NULL DEFAULT '[]',
        subjects TEXT NOT NULL DEFAULT '[]',
        cover_data BLOB,
        cover_mime TEXT,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]',
        chapter_names TEXT
      );
      CREATE TABLE book_thumbnails (
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE ON UPDATE CASCADE,
        width INTEGER NOT NULL,
        data BLOB NOT NULL,
        mime TEXT NOT NULL,
        PRIMARY KEY (book_id, width)
      );
      PRAGMA user_version = 6;
    `);

    const nonexistent = path.join(booksDir, 'gone.epub');
    seedDb
      .prepare(
        `INSERT INTO books (id, filename, path, title, size, mtime, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('ghost-id', 'gone.epub', nonexistent, 'Ghost', 7, 0, 0);
    seedDb.close();

    const realDb = new Database(dbPath);
    const store = new BookStore(booksDir, realDb);

    // Row stays in DB (next scan will remove it).
    const book = store.getBookById('ghost-id');
    expect(book).not.toBeNull();

    realDb.close();
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx jest app/services/book-store.test.ts -t 'migration v7'`
Expected: FAIL — migration doesn't exist yet.

- [ ] **Step 3: Add the v7 migration block**

In `app/services/book-store.ts`, at the end of `migrate()` (after the `if (user_version < 6) { ... }` block), add:

```typescript
    if (user_version < 7) {
      const rows = this.db
        .prepare('SELECT id, filename, path FROM books')
        .all() as Array<{ id: string; filename: string; path: string }>;

      for (const row of rows) {
        const canonical = path.join(this.booksDir, row.id + '.epub');
        const src = row.path && row.path.length > 0
          ? row.path
          : path.join(this.booksDir, row.filename);

        if (!fs.existsSync(src)) {
          log.warn(`migration v7: source file missing for book ${row.id} (${src}); skipping rename`);
          continue;
        }
        if (path.resolve(src) === path.resolve(canonical)) {
          continue;
        }
        if (fs.existsSync(canonical)) {
          log.warn(
            `migration v7: canonical path ${canonical} already occupied; skipping rename for ${row.id}`
          );
          continue;
        }
        try {
          fs.renameSync(src, canonical);
        } catch (err: unknown) {
          log.warn(
            `migration v7: failed to rename ${src} → ${canonical}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE books_new (
            id            TEXT    PRIMARY KEY,
            title         TEXT    NOT NULL,
            file_as       TEXT    NOT NULL DEFAULT '',
            author        TEXT    NOT NULL DEFAULT '',
            description   TEXT    NOT NULL DEFAULT '',
            publisher     TEXT    NOT NULL DEFAULT '',
            series        TEXT    NOT NULL DEFAULT '',
            series_index  REAL    NOT NULL DEFAULT 0,
            identifiers   TEXT    NOT NULL DEFAULT '[]',
            subjects      TEXT    NOT NULL DEFAULT '[]',
            cover_data    BLOB,
            cover_mime    TEXT,
            size          INTEGER NOT NULL,
            mtime         INTEGER NOT NULL,
            added_at      INTEGER NOT NULL,
            chapter_count INTEGER NOT NULL DEFAULT 0,
            chapter_spine_map TEXT NOT NULL DEFAULT '[]',
            chapter_names TEXT
          );
          INSERT INTO books_new (id, title, file_as, author, description, publisher, series,
                                 series_index, identifiers, subjects, cover_data, cover_mime,
                                 size, mtime, added_at, chapter_count, chapter_spine_map, chapter_names)
          SELECT id, title, file_as, author, description, publisher, series, series_index,
                 identifiers, subjects, cover_data, cover_mime, size, mtime, added_at,
                 chapter_count, chapter_spine_map, chapter_names
          FROM books;
          DROP TABLE books;
          ALTER TABLE books_new RENAME TO books;
        `);
        this.db.exec('PRAGMA user_version = 7');
      })();
      log.info(`Migration v7: canonicalized ${rows.length} book file(s); dropped filename/path columns`);
    }
```

Now that the columns are dropped, `addBook`'s INSERT (which still references `filename` and `path`) must also be updated. Replace the `INSERT INTO books (id, filename, path, title, ...)` statement in `addBook` with one that omits those two columns:

```typescript
  this.db
    .prepare(
      `
      INSERT INTO books (id, title, file_as, author, description, publisher,
                         series, series_index, identifiers, subjects, cover_data, cover_mime,
                         size, mtime, added_at, chapter_count, chapter_spine_map, chapter_names)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      id,
      title,
      fileAs,
      meta.author,
      meta.description,
      meta.publisher,
      meta.series,
      meta.seriesIndex,
      JSON.stringify(meta.identifiers),
      JSON.stringify(meta.subjects),
      meta.coverData,
      meta.coverMime,
      stat.size,
      stat.mtimeMs,
      Date.now(),
      meta.chapterCount,
      JSON.stringify(meta.chapterSpineMap),
      JSON.stringify(meta.chapterNames)
    );
```

Also remove the local `const filename = id + '.epub';` and the `targetPath` argument from the parameter list of the `.run(...)` call — both were only there to feed the old columns.

In `migrate()`, the initial `CREATE TABLE IF NOT EXISTS books (...)` at the top of `migrate()` still includes `filename TEXT NOT NULL UNIQUE` and `path TEXT NOT NULL`. For a brand-new database, that creates the columns, then immediately the v7 block tries to drop them — wasteful. Replace the initial `CREATE TABLE IF NOT EXISTS` with the post-migration shape (no `filename`, no `path`):

```typescript
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS books (
        id            TEXT    PRIMARY KEY,
        title         TEXT    NOT NULL,
        file_as       TEXT    NOT NULL DEFAULT '',
        author        TEXT    NOT NULL DEFAULT '',
        description   TEXT    NOT NULL DEFAULT '',
        publisher     TEXT    NOT NULL DEFAULT '',
        series        TEXT    NOT NULL DEFAULT '',
        series_index  REAL    NOT NULL DEFAULT 0,
        identifiers   TEXT    NOT NULL DEFAULT '[]',
        subjects      TEXT    NOT NULL DEFAULT '[]',
        cover_data    BLOB,
        cover_mime    TEXT,
        size          INTEGER NOT NULL,
        mtime         INTEGER NOT NULL,
        added_at      INTEGER NOT NULL,
        chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]',
        chapter_names TEXT
      )
    `);
```

For a fresh DB, the v7 migration block will then find no rows, perform no renames, and just bump `user_version` to 7. For an existing DB at any version < 7, the legacy CREATE-TABLE-IF-NOT-EXISTS is a no-op (the table already exists with the old shape), the v2–v6 blocks all run, then v7 rebuilds and drops the columns.

The earlier migrations (v2 specifically) reference `book.path` to call `partialMD5`. That still works in v2's block because the rows at that point still have `path`. Verify by tracing the migration order: v2 → reads `path` → no problem (columns still exist). v7 → reads `path` and `filename` → no problem (columns still exist until the rebuild inside v7).

Existing migration tests in `book-store.test.ts` (around lines 460–620, the v2/v3/v4/v5 migration tests) seed databases at older `user_version` values. With the v7 block now running on top, those tests' assertions about column presence may need adjustment: any `expect(columns).toContain('filename')` or assertion that selects from `books.filename` after migration must be removed or rewritten — the columns are gone after migration completes. If a test runs `PRAGMA user_version = 1` then constructs a `BookStore`, all migrations through v7 fire and the resulting `books` table no longer has `filename`/`path`. Update those tests to assert on the data preserved (id, title, etc.), not on the dropped columns.

- [ ] **Step 4: Run migration tests**

Run: `npx jest app/services/book-store.test.ts -t 'migration v7'`
Expected: PASS.

- [ ] **Step 5: Run the full book-store test file**

Run: `npx jest app/services/book-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/services/book-store.ts app/services/book-store.test.ts
git commit -m "feat: schema migration v7 drops filename/path columns"
```

---

## Task 8: Upload route — stage in `.staging/`, call new `addBook`, return 409

The current upload handler saves directly into `<booksDir>/<originalname>` via Multer, then calls `addBook(id, file.originalname, savedPath, file.size, new Date(), meta)`. After this task it stages into `<booksDir>/.staging/<uuid>-<originalname>`, parses, and calls `addBook(id, savedPath, meta)`. Duplicates surface as `409`. The empty-title fallback (previously inside `addBook`) is reproduced here using `file.originalname`.

**Files:**
- Modify: `app/routes/ui.ts`
- Modify: `app/routes/ui.test.ts`

- [ ] **Step 1: Write the failing tests**

In `app/routes/ui.test.ts`, inside the `describe('POST /api/books/upload', ...)` block (or alongside it), add:

```typescript
  it('places uploaded file at <booksDir>/<id>.epub', async () => {
    const agent = await adminAgent();
    const epubBuf = makeEpub({ title: 'Stored Book', author: 'A' });
    const res = await agent.post('/api/books/upload').attach('files', epubBuf, 'human-name.epub');
    expect(res.status).toBe(200);
    const books = bookStore.listBooks();
    expect(books).toHaveLength(1);
    const onDisk = fs.readdirSync(booksDir).filter((f) => f.endsWith('.epub'));
    expect(onDisk).toEqual([books[0].id + '.epub']);
  });

  it('returns 409 when uploading a duplicate (same content twice)', async () => {
    const agent = await adminAgent();
    const epubBuf = makeEpub({ title: 'Dup', author: 'A' });
    await agent.post('/api/books/upload').attach('files', epubBuf, 'first.epub');
    const res = await agent.post('/api/books/upload').attach('files', epubBuf, 'second.epub');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in the library/i);
  });

  it('falls back to original-filename stem when title metadata is empty', async () => {
    const agent = await adminAgent();
    const epubBuf = makeEpub({ author: 'A' }); // no title
    await agent.post('/api/books/upload').attach('files', epubBuf, 'my-book.epub');
    const books = bookStore.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe('my-book');
  });

  it('cleans up staging directory after successful upload', async () => {
    const agent = await adminAgent();
    const epubBuf = makeEpub({ title: 'Clean', author: 'A' });
    await agent.post('/api/books/upload').attach('files', epubBuf, 'clean.epub');
    const stagingDir = path.join(booksDir, '.staging');
    const staged = fs.existsSync(stagingDir) ? fs.readdirSync(stagingDir) : [];
    expect(staged).toEqual([]);
  });
```

- [ ] **Step 2: Run the new tests to confirm they fail**

Run: `npx jest app/routes/ui.test.ts -t 'POST /api/books/upload'`
Expected: At minimum the 409 and the on-disk-name tests fail.

- [ ] **Step 3: Replace the Multer storage configuration**

In `app/routes/ui.ts`, near the top of `createUiRouter`, replace the existing `storage` and `upload` blocks (currently using `bookStore.getBooksDir()` directly) with:

```typescript
  const stagingDir = path.join(bookStore.getBooksDir(), '.staging');
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        fs.mkdirSync(stagingDir, { recursive: true });
        cb(null, stagingDir);
      } catch (err) {
        cb(err as Error, stagingDir);
      }
    },
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      cb(null, `${unique}-${path.basename(file.originalname)}`);
    },
  });
```

The `upload = multer({ storage, fileFilter: ... })` block stays as-is.

- [ ] **Step 4: Replace the upload handler body**

Currently:

```typescript
router.post(
  '/api/books/upload',
  sessionAuth,
  upload.array('files'),
  async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) {
      log.warn('Upload rejected — no valid files (supported: epub)');
      res.status(400).json({ error: 'No valid files uploaded. Supported: epub' });
      return;
    }
    const uploaded: string[] = [];
    for (const file of files) {
      const savedPath = file.path;
      let meta: EpubMeta;
      let id: string;
      try {
        meta = parseEpub(savedPath);
        id = partialMD5(savedPath);
      } catch (err: unknown) {
        fs.unlinkSync(savedPath);
        res.status(400).json({
          error: `Failed to parse EPUB: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      bookStore.addBook(id, file.originalname, savedPath, file.size, new Date(), meta);
      thumbnailQueue.enqueue(id);
      uploaded.push(file.originalname);
    }
    log.info(`Books uploaded: ${uploaded.join(', ')}`);
    res.json({ uploaded });
  }
);
```

Replace with:

```typescript
router.post(
  '/api/books/upload',
  sessionAuth,
  upload.array('files'),
  async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) {
      log.warn('Upload rejected — no valid files (supported: epub)');
      res.status(400).json({ error: 'No valid files uploaded. Supported: epub' });
      return;
    }
    const uploaded: string[] = [];
    for (const file of files) {
      const savedPath = file.path;
      let meta: EpubMeta;
      let id: string;
      try {
        meta = parseEpub(savedPath);
        id = partialMD5(savedPath);
      } catch (err: unknown) {
        try { fs.unlinkSync(savedPath); } catch { /* ignore */ }
        res.status(400).json({
          error: `Failed to parse EPUB: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      const titleFallback =
        meta.title.trim() || path.basename(file.originalname, path.extname(file.originalname));
      try {
        bookStore.addBook(id, savedPath, { ...meta, title: titleFallback });
      } catch (err: unknown) {
        try { fs.unlinkSync(savedPath); } catch { /* ignore */ }
        if (err instanceof BookAlreadyExistsError) {
          res.status(409).json({
            error: 'A book with the same fingerprint is already in the library.',
          });
          return;
        }
        throw err;
      }
      thumbnailQueue.enqueue(id);
      uploaded.push(file.originalname);
    }
    log.info(`Books uploaded: ${uploaded.join(', ')}`);
    res.json({ uploaded });
  }
);
```

Add `BookAlreadyExistsError` to the existing import from `book-store`:

```typescript
import { BookStore, BookHashCollisionError, BookAlreadyExistsError } from '../services/book-store';
```

- [ ] **Step 5: Run the upload tests**

Run: `npx jest app/routes/ui.test.ts -t 'POST /api/books/upload'`
Expected: PASS, including the new 409 and on-disk-name tests.

- [ ] **Step 6: Run the full ui test file**

Run: `npx jest app/routes/ui.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/routes/ui.ts app/routes/ui.test.ts
git commit -m "feat: stage uploads, store as <id>.epub, 409 on duplicates"
```

---

## Task 9: OPDS download-name assertion

The OPDS download endpoint already uses `book.filename` for `Content-Disposition`. With `Book.filename` now being the computed download name, the header will already contain the right thing — we just need test coverage proving it.

**Files:**
- Modify: `app/routes/opds.test.ts`

- [ ] **Step 1: Locate the existing download test**

Run: `grep -n "download" app/routes/opds.test.ts | head -20`

Find the `describe('GET /opds/books/:id/download', ...)` (or equivalent) block.

- [ ] **Step 2: Add a new test inside it**

```typescript
  it('uses the computed download name in Content-Disposition', async () => {
    // Seed a book with author + series + index + title that exercises every field.
    const epubBuf = makeEpub({
      title: 'The Fellowship of the Ring',
      author: 'J.R.R. Tolkien',
      series: 'The Lord of the Rings',
      seriesIndex: 1,
    });
    const onDisk = path.join(booksDir, 'lotr1.epub');
    fs.writeFileSync(onDisk, epubBuf);
    // Import via bookStore so id + path are correct.
    bookStore.scan();
    const book = bookStore.listBooks()[0];

    const res = await request(app)
      .get(`/opds/books/${book.id}/download`)
      .auth('alice', 'alicepass');

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /J\.R\.R\._Tolkien-The_Lord_of_the_Rings-1-The_Fellowship_of_the_Ring\.epub/
    );
  });
```

If the existing `opds.test.ts` does not already define a `makeEpub` helper or a `request(app)` setup with the `bookStore`, mirror the setup pattern from the closest existing download test in the same file. The above assumes patterns visible at the top of `app/routes/opds.test.ts` (use `Read` to confirm).

- [ ] **Step 3: Run the new test**

Run: `npx jest app/routes/opds.test.ts -t 'computed download name'`
Expected: PASS (no source change needed; behavior fell out naturally).

- [ ] **Step 4: Run the full opds test file**

Run: `npx jest app/routes/opds.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/routes/opds.test.ts
git commit -m "test: verify OPDS download Content-Disposition uses computed filename"
```

---

## Task 10: Whole-suite verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run lint and typecheck**

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 3: If lint or tests fail, fix in place; do NOT commit on top of a broken state**

Investigate root causes. Likely categories of remaining issues:
- A stray `book.path` or `book.filename` assertion in a test that was missed during earlier mechanical updates.
- An unused import (`fs`, `path`, or a removed helper) flagged by ESLint — remove.
- A type error from `BookRow` shape change — adjust the offending site to match.

After fixing, re-run both commands until clean.

- [ ] **Step 4: Final commit (only if changes were needed)**

```bash
git add -A
git commit -m "chore: lint and test cleanup after filename canonicalization"
```

- [ ] **Step 5: Push the branch**

```bash
git push -u GitHub feat/canonical-book-filenames
```

Report the branch URL back to the user for PR creation.

---

## Self-Review Checklist

After implementing all tasks, the engineer should verify:

1. **Spec coverage** — every section of `docs/superpowers/specs/2026-05-18-book-filename-canonicalization-design.md` has a corresponding task:
   - Storage model + migration → Tasks 3, 4, 7.
   - Download-filename rules → Task 1.
   - Touchpoints in book-store.ts → Tasks 3, 4, 5, 6, 7.
   - Touchpoints in ui.ts → Task 8.
   - OPDS unchanged behavior → Task 9 (test only).
   - Error handling for duplicates and rename collisions → Tasks 4, 6, 7.
   - Test coverage list → Tasks 1, 4, 5, 6, 7, 8, 9.

2. **No placeholders** — every step shows actual code or an exact command.

3. **Type consistency** — `addBook` is `(id, srcPath, meta)` everywhere after Task 4; `BookRow` has no `filename`/`path` after Task 3; `Book.filename` is a computed download name everywhere; `BookAlreadyExistsError` is the exception name throughout.

4. **Test invariants:** the suite must pass at the end of *every* task, not just the last one. Each task includes a `npx jest` step before its commit.

# Book Page Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Adobe-standard page count (1,024 chars = 1 page) to every book, computed from all spine content at import time and displayed on the book page and series page.

**Architecture:** `parseEpub` already has the EPUB zip open and iterates spine items; we add a character-count pass there, persist `page_count` in SQLite via migration v8 (which also backfills existing books), and surface `pageCount` in the client type and two React pages.

**Tech Stack:** TypeScript, better-sqlite3, AdmZip, React, Jest

---

## File Map

| File | Change |
|------|--------|
| `app/types.ts` | Add `pageCount: number` to `EpubMeta` and `Book` |
| `app/services/epub-parser.ts` | Compute `pageCount` from spine items in `parseEpub` |
| `app/services/epub-parser.test.ts` | Tests for page count computation |
| `app/services/book-store.ts` | Migration v8, `page_count` column, update all SQL |
| `app/services/book-store.test.ts` | Update `FAKE_META`; tests for DB round-trip and migration |
| `client/src/provider/book/type.ts` | Add `pageCount: number` to client `Book` type |
| `client/src/page/book/index.tsx` | Display `pages` in metadata section |
| `client/src/page/series/index.tsx` | Display summed `pages` in metadata section |

---

### Task 1: Add `pageCount` to `EpubMeta` and compute it in `parseEpub`

**Files:**
- Modify: `app/types.ts`
- Modify: `app/services/epub-parser.ts`
- Modify: `app/services/epub-parser.test.ts`

- [ ] **Step 1: Add `pageCount` to the `EpubMeta` interface**

In `app/types.ts`, add `pageCount: number` as the last field of `EpubMeta`:

```typescript
export interface EpubMeta {
  title: string;
  fileAs: string;
  author: string;
  description: string;
  publisher: string;
  series: string;
  seriesIndex: number;
  identifiers: { scheme: string; value: string }[];
  subjects: string[];
  coverData: Buffer | null;
  coverMime: string | null;
  chapterCount: number;
  chapterSpineMap: number[];
  chapterNames: string[];
  pageCount: number;
}
```

- [ ] **Step 2: Add a `makeEpubWithSpine` helper to `epub-parser.test.ts`**

Add this function after the existing `makeEpubWithNcx` helper (search for `function makeEpubWithNcx` to find the right location):

```typescript
function makeEpubWithSpine(bodyContent: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
  );
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title></metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/></spine>
</package>`)
  );
  zip.addFile('OEBPS/ch1.xhtml', Buffer.from(`<html><body>${bodyContent}</body></html>`));
  return zip.toBuffer();
}
```

- [ ] **Step 3: Write the failing `pageCount` tests in `epub-parser.test.ts`**

Add a new `describe` block at the end of the file:

```typescript
describe('pageCount', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-pagecount-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  function writeTmp(buf: Buffer, name = 'test.epub'): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, buf);
    return p;
  }

  it('computes 2 pages for 2048-char spine content', () => {
    const p = writeTmp(makeEpubWithSpine('A'.repeat(2048)));
    expect(parseEpub(p).pageCount).toBe(2);
  });

  it('computes 1 page for content shorter than 1024 chars', () => {
    const p = writeTmp(makeEpubWithSpine('Hello'));
    expect(parseEpub(p).pageCount).toBe(1);
  });

  it('returns 0 for an EPUB with no spine items', () => {
    // makeEpub() produces <spine toc="ncx"/> with no itemrefs
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-empty-'));
    const p = path.join(tmp, 'test.epub');
    fs.writeFileSync(p, makeEpub());
    const meta = parseEpub(p);
    fs.rmSync(tmp, { recursive: true });
    expect(meta.pageCount).toBe(0);
  });

  it('strips HTML tags before counting characters', () => {
    // <p>Hello</p> strips to "Hello" (5 chars) → 1 page
    const p = writeTmp(makeEpubWithSpine('<p>Hello</p>'));
    expect(parseEpub(p).pageCount).toBe(1);
  });
});
```

- [ ] **Step 4: Run the tests to confirm they fail**

```bash
npx jest app/services/epub-parser.test.ts --testNamePattern="pageCount" 2>&1 | tail -20
```

Expected: 4 failures — `pageCount` property does not exist on `EpubMeta`.

- [ ] **Step 5: Implement `pageCount` computation in `parseEpub`**

In `app/services/epub-parser.ts`, add the character-count loop after the `spineHrefToIndex` map is built (after the `for (let i = 0; i < spineItemRefs.length...` loop that populates `spineHrefToIndex`, and before the `const { chapterCount, chapterSpineMap, chapterNames } = parseNavChapters(...)` call).

Find this exact line:
```typescript
  const { chapterCount, chapterSpineMap, chapterNames } = parseNavChapters(
```

Insert before it:

```typescript
  // Compute Adobe standard page count: 1 page = 1,024 characters (including spaces)
  let totalChars = 0;
  for (const itemRef of spineItemRefs) {
    const href = hrefByManifestId.get(itemRef['@_idref']);
    if (!href) continue;
    const absHref = opfDir === '.' ? href : `${opfDir}/${href}`;
    const entry = zip.getEntry(absHref) ?? zip.getEntry(href);
    if (!entry) continue;
    const text = entry.getData().toString('utf8').replace(/<[^>]*>/g, '');
    totalChars += text.length;
  }
  const pageCount = Math.ceil(totalChars / 1024);
```

Then add `pageCount` to the return object at the bottom of `parseEpub`. Find the closing return statement:

```typescript
  return {
    title,
    fileAs,
    author,
    description,
    publisher,
    identifiers,
    subjects,
    series,
    seriesIndex,
    coverData,
    coverMime,
    chapterCount,
    chapterSpineMap,
    chapterNames,
  };
```

Replace with:

```typescript
  return {
    title,
    fileAs,
    author,
    description,
    publisher,
    identifiers,
    subjects,
    series,
    seriesIndex,
    coverData,
    coverMime,
    chapterCount,
    chapterSpineMap,
    chapterNames,
    pageCount,
  };
```

- [ ] **Step 6: Run the tests to confirm they pass**

```bash
npx jest app/services/epub-parser.test.ts --testNamePattern="pageCount" 2>&1 | tail -20
```

Expected: 4 tests pass.

- [ ] **Step 7: Run the full epub-parser test suite**

```bash
npx jest app/services/epub-parser.test.ts 2>&1 | tail -10
```

Expected: All tests pass. (The type compiler will complain in the next task since `EpubMeta.pageCount` is not yet used in `book-store.ts`, but that's resolved there.)

- [ ] **Step 8: Commit**

```bash
git add app/types.ts app/services/epub-parser.ts app/services/epub-parser.test.ts
git commit -m "feat(page-count): compute pageCount in parseEpub (1 page = 1024 chars)"
```

---

### Task 2: Store `pageCount` in SQLite — migration v8, all DB operations

**Files:**
- Modify: `app/types.ts`
- Modify: `app/services/book-store.ts`
- Modify: `app/services/book-store.test.ts`

- [ ] **Step 1: Add `pageCount` to the `Book` interface in `app/types.ts`**

Add `pageCount: number` as the last field of `Book`:

```typescript
export interface Book {
  id: string;
  filename: string;
  path: string;
  title: string;
  fileAs: string;
  author: string;
  description: string;
  publisher: string;
  series: string;
  seriesIndex: number;
  identifiers: { scheme: string; value: string }[];
  subjects: string[];
  hasCover: boolean;
  size: number;
  mtime: Date;
  addedAt: Date;
  chapterCount: number;
  chapterSpineMap: number[];
  chapterNames: string[];
  pageCount: number;
}
```

- [ ] **Step 2: Update `FAKE_META` in `book-store.test.ts`**

Find the `FAKE_META` constant and add `pageCount: 0`:

```typescript
const FAKE_META: EpubMeta = {
  title: 'Test Book',
  author: 'Author Name',
  description: 'A test description',
  publisher: 'Test Publisher',
  series: 'Test Series',
  seriesIndex: 1,
  fileAs: '',
  identifiers: [{ scheme: 'ISBN', value: '978-0000000000' }],
  subjects: ['Fiction'],
  coverData: Buffer.from('fake-cover'),
  coverMime: 'image/jpeg',
  chapterCount: 0,
  chapterSpineMap: [],
  chapterNames: [],
  pageCount: 0,
};
```

- [ ] **Step 3: Add `makeMinimalEpubWithContent` helper to `book-store.test.ts`**

Add this function after the existing `makeMinimalEpub` helper (just before `function stage`):

```typescript
function makeMinimalEpubWithContent(bodyContent: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
  );
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title></metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/></spine>
</package>`)
  );
  zip.addFile('OEBPS/ch1.xhtml', Buffer.from(`<html><body>${bodyContent}</body></html>`));
  return zip.toBuffer();
}
```

- [ ] **Step 4: Write the failing `pageCount` tests in `book-store.test.ts`**

Add a new `describe('page count data')` block after the existing `describe('chapter data')` block:

```typescript
describe('page count data', () => {
  it('DB migration adds page_count column', () => {
    const cols = db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('page_count');
  });

  it('stores and retrieves pageCount', () => {
    bookStore.addBook('id1', stage('id1'), { ...FAKE_META, pageCount: 42 });
    expect(bookStore.getBookById('id1')?.pageCount).toBe(42);
  });

  it('defaults to 0 when pageCount is not set', () => {
    bookStore.addBook('id2', stage('id2'), { ...FAKE_META, pageCount: 0 });
    expect(bookStore.getBookById('id2')?.pageCount).toBe(0);
  });
});
```

Add migration v8 tests inside the existing `describe('migrations')` block, after the last test in that block:

```typescript
  it('migration v8: adds page_count column to existing v7 table', () => {
    const preDb = new Database(':memory:');
    preDb.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, file_as TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
        publisher TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0, identifiers TEXT NOT NULL DEFAULT '[]',
        subjects TEXT NOT NULL DEFAULT '[]', cover_data BLOB, cover_mime TEXT,
        size INTEGER NOT NULL, mtime INTEGER NOT NULL, added_at INTEGER NOT NULL,
        chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]',
        chapter_names TEXT
      )
    `);
    preDb.exec('PRAGMA user_version = 7');

    new BookStore(booksDir, preDb);

    const cols = preDb.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('page_count');
    expect(preDb.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 8 });

    preDb.close();
  });

  it('migration v8: backfills page_count for existing books on disk', () => {
    const preDb = new Database(':memory:');
    preDb.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, file_as TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
        publisher TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0, identifiers TEXT NOT NULL DEFAULT '[]',
        subjects TEXT NOT NULL DEFAULT '[]', cover_data BLOB, cover_mime TEXT,
        size INTEGER NOT NULL, mtime INTEGER NOT NULL, added_at INTEGER NOT NULL,
        chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]',
        chapter_names TEXT
      )
    `);
    preDb.exec('PRAGMA user_version = 7');

    const id = 'backfill-test';
    const epubPath = path.join(booksDir, `${id}.epub`);
    fs.writeFileSync(epubPath, makeMinimalEpubWithContent('A'.repeat(2048)));

    preDb
      .prepare('INSERT INTO books (id, title, size, mtime, added_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'Test Book', 100, 0, 0);

    new BookStore(booksDir, preDb);

    const row = preDb
      .prepare('SELECT page_count FROM books WHERE id = ?')
      .get(id) as { page_count: number };
    expect(row.page_count).toBe(2);

    preDb.close();
  });

  it('migration v8: skips missing EPUB files and leaves page_count at 0', () => {
    const preDb = new Database(':memory:');
    preDb.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, file_as TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
        publisher TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0, identifiers TEXT NOT NULL DEFAULT '[]',
        subjects TEXT NOT NULL DEFAULT '[]', cover_data BLOB, cover_mime TEXT,
        size INTEGER NOT NULL, mtime INTEGER NOT NULL, added_at INTEGER NOT NULL,
        chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]',
        chapter_names TEXT
      )
    `);
    preDb.exec('PRAGMA user_version = 7');
    preDb
      .prepare('INSERT INTO books (id, title, size, mtime, added_at) VALUES (?, ?, ?, ?, ?)')
      .run('missing-id', 'Gone', 100, 0, 0);

    expect(() => new BookStore(booksDir, preDb)).not.toThrow();

    const row = preDb
      .prepare('SELECT page_count FROM books WHERE id = ?')
      .get('missing-id') as { page_count: number };
    expect(row.page_count).toBe(0);

    preDb.close();
  });

  it('migration v8: does not re-run when user_version is already 8', () => {
    const preDb = new Database(':memory:');
    preDb.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', file_as TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
        publisher TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0, identifiers TEXT NOT NULL DEFAULT '[]',
        subjects TEXT NOT NULL DEFAULT '[]', cover_data BLOB, cover_mime TEXT,
        size INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL DEFAULT 0, chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]', chapter_names TEXT,
        page_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    preDb.exec('PRAGMA user_version = 8');
    preDb
      .prepare('INSERT INTO books (id, title, page_count) VALUES (?, ?, ?)')
      .run('pinned-id', 'Test', 99);

    new BookStore(booksDir, preDb);

    const row = preDb
      .prepare('SELECT page_count FROM books WHERE id = ?')
      .get('pinned-id') as { page_count: number };
    expect(row.page_count).toBe(99);

    preDb.close();
  });
```

- [ ] **Step 5: Run the tests to confirm they fail**

```bash
npx jest app/services/book-store.test.ts --testNamePattern="page count|migration v8" 2>&1 | tail -25
```

Expected: 7 failures — `page_count` column doesn't exist, `pageCount` not on `Book`.

- [ ] **Step 6: Add `page_count` to the `BookRow` interface in `book-store.ts`**

Find the `interface BookRow` and add `page_count: number` after `chapter_names`:

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
  identifiers: string;
  subjects: string;
  has_cover: number;
  chapter_count: number;
  chapter_spine_map: string;
  chapter_names: string | null;
  size: number;
  mtime: number;
  added_at: number;
  page_count: number;
}
```

- [ ] **Step 7: Add migration v8 to `book-store.ts`**

Find the closing `}` of migration v7 (the line that reads `this.db.exec('PRAGMA user_version = 7');` followed by a `}`). Add migration v8 immediately after:

```typescript
    if (user_version < 8) {
      const v8Cols = this.db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
      if (!v8Cols.some((c) => c.name === 'page_count')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0`);
      }
      const toBackfill = this.db
        .prepare('SELECT id FROM books WHERE page_count = 0')
        .all() as Array<{ id: string }>;
      const updatePageCount = this.db.prepare('UPDATE books SET page_count = ? WHERE id = ?');
      for (const { id } of toBackfill) {
        const filePath = path.join(this.booksDir, id + '.epub');
        try {
          const meta = parseEpub(filePath);
          updatePageCount.run(meta.pageCount, id);
        } catch {
          log.warn(`Migration v8: failed to compute page count for book ${id}; leaving at 0`);
        }
      }
      this.db.exec('PRAGMA user_version = 8');
    }
```

- [ ] **Step 8: Update `addBook` to include `page_count`**

Find the `INSERT INTO books` statement in `addBook`. Replace:

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

With:

```typescript
    this.db
      .prepare(
        `
      INSERT INTO books (id, title, file_as, author, description, publisher,
                         series, series_index, identifiers, subjects, cover_data, cover_mime,
                         size, mtime, added_at, chapter_count, chapter_spine_map, chapter_names,
                         page_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(meta.chapterNames),
        meta.pageCount
      );
```

- [ ] **Step 9: Update `reimportBook` — "id changed" UPDATE path**

Find this SQL in `reimportBook`:

```typescript
            `UPDATE books SET id=?, title=?, file_as=?, author=?, description=?, publisher=?,
             series=?, series_index=?, identifiers=?, subjects=?, cover_data=?, cover_mime=?,
             size=?, mtime=?, chapter_count=?, chapter_spine_map=?, chapter_names=? WHERE id=?`
```

Replace with:

```typescript
            `UPDATE books SET id=?, title=?, file_as=?, author=?, description=?, publisher=?,
             series=?, series_index=?, identifiers=?, subjects=?, cover_data=?, cover_mime=?,
             size=?, mtime=?, chapter_count=?, chapter_spine_map=?, chapter_names=?, page_count=? WHERE id=?`
```

And add `meta.pageCount` to the `.run(...)` call, between `JSON.stringify(meta.chapterNames)` and `id`:

```typescript
          .run(
            newId,
            meta.title.trim(),
            (meta.fileAs || '').trim(),
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
            stat.mtime.getTime(),
            meta.chapterCount,
            JSON.stringify(meta.chapterSpineMap),
            JSON.stringify(meta.chapterNames),
            meta.pageCount,
            id
          );
```

- [ ] **Step 10: Update `reimportBook` — "id same" UPDATE path**

Find this SQL in `reimportBook` (the `else` branch):

```typescript
            `UPDATE books SET title=?, file_as=?, author=?, description=?, publisher=?,
             series=?, series_index=?, identifiers=?, subjects=?, cover_data=?, cover_mime=?,
             size=?, mtime=?, chapter_count=?, chapter_spine_map=?, chapter_names=? WHERE id=?`
```

Replace with:

```typescript
            `UPDATE books SET title=?, file_as=?, author=?, description=?, publisher=?,
             series=?, series_index=?, identifiers=?, subjects=?, cover_data=?, cover_mime=?,
             size=?, mtime=?, chapter_count=?, chapter_spine_map=?, chapter_names=?, page_count=? WHERE id=?`
```

And add `meta.pageCount` to the `.run(...)` call, between `JSON.stringify(meta.chapterNames)` and `id`:

```typescript
          .run(
            meta.title.trim(),
            (meta.fileAs || '').trim(),
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
            stat.mtime.getTime(),
            meta.chapterCount,
            JSON.stringify(meta.chapterSpineMap),
            JSON.stringify(meta.chapterNames),
            meta.pageCount,
            id
          );
```

- [ ] **Step 11: Update `listBooks` and `getBookById` SELECT statements**

In `listBooks`, find:

```typescript
      SELECT id, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map, chapter_names
      FROM books
```

Replace with:

```typescript
      SELECT id, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map, chapter_names, page_count
      FROM books
```

In `getBookById`, find:

```typescript
      SELECT id, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map, chapter_names
      FROM books WHERE id = ?
```

Replace with:

```typescript
      SELECT id, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map, chapter_names, page_count
      FROM books WHERE id = ?
```

- [ ] **Step 12: Update `rowToBook` to map `page_count`**

In `rowToBook`, find the closing `};` of the return object and add `pageCount` before it:

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
      pageCount: r.page_count,
    };
  }
```

- [ ] **Step 13: Run the page count and migration v8 tests to confirm they pass**

```bash
npx jest app/services/book-store.test.ts --testNamePattern="page count|migration v8" 2>&1 | tail -25
```

Expected: 7 tests pass.

- [ ] **Step 14: Run the full test suite**

```bash
npx jest 2>&1 | tail -15
```

Expected: All tests pass.

- [ ] **Step 15: Commit**

```bash
git add app/types.ts app/services/book-store.ts app/services/book-store.test.ts
git commit -m "feat(page-count): add page_count column and migration v8 with backfill"
```

---

### Task 3: Add `pageCount` to the client `Book` type and display it in the UI

**Files:**
- Modify: `client/src/provider/book/type.ts`
- Modify: `client/src/page/book/index.tsx`
- Modify: `client/src/page/series/index.tsx`

- [ ] **Step 1: Add `pageCount` to the client `Book` type**

In `client/src/provider/book/type.ts`, add `pageCount: number` after `chapterNames`:

```typescript
export type Book = {
  id: string;
  title: string;
  author: string;
  fileAs: string;
  publisher?: string;
  series: string;
  seriesIndex: number;
  description?: string;
  subjects: string[];
  identifiers: Identifier[];
  hasCover: boolean;
  size: number;
  addedAt?: string;
  chapterCount: number;
  chapterSpineMap?: number[];
  chapterNames?: string[];
  pageCount: number;
};
```

- [ ] **Step 2: Display `pages` in the book page metadata section**

In `client/src/page/book/index.tsx`, find the block that pushes `chapters` metadata:

```typescript
  if (book !== undefined && book.chapterCount > 0) {
    metadata.push({ title: 'chapters', value: book.chapterCount.toString() });
  }
```

Add the following immediately after it:

```typescript
  if (book !== undefined && book.pageCount > 0) {
    metadata.push({ title: 'pages', value: book.pageCount.toString() });
  }
```

- [ ] **Step 3: Display summed `pages` in the series page metadata section**

In `client/src/page/series/index.tsx`, find the `metadata.push` call for `books`:

```typescript
  metadata.push({
    title: 'books',
    value: seriesBookList?.length,
  });
```

Add the following immediately after it:

```typescript
  const totalPages = seriesBookList.reduce((sum, book) => sum + book.pageCount, 0);
  if (totalPages > 0) {
    metadata.push({ title: 'pages', value: totalPages });
  }
```

- [ ] **Step 4: Run the TypeScript compiler to verify no type errors**

```bash
cd /workspaces/HASS-ODPS && npx tsc --noEmit 2>&1 | head -30
cd /workspaces/HASS-ODPS/client && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 5: Run the full server test suite one final time**

```bash
cd /workspaces/HASS-ODPS && npx jest 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/provider/book/type.ts client/src/page/book/index.tsx client/src/page/series/index.tsx
git commit -m "feat(page-count): display pages metadata on book and series pages"
```

# Chapter Progress Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store chapter title strings from EPUB nav documents and display the current chapter's name alongside its number in the `ChapterProgress` UI control.

**Architecture:** Extend `flattenNavOl`/`flattenNcxNavPoints` in the EPUB parser to return `{href, title}` pairs; thread `chapterNames: string[]` through `EpubMeta` → DB column `chapter_names` (migration v5) → `Book` type → `GET /api/my/progress` response field `currentChapterName` → `ChapterProgress` component prop `name`.

**Tech Stack:** TypeScript, better-sqlite3 (SQLite), Express, React, JSS (createUseStyles)

---

## File Map

| File | Change |
|------|--------|
| `app/types.ts` | Add `chapterNames: string[]` to `Book` and `EpubMeta` |
| `app/services/epub-parser.ts` | Return `{href, title}` pairs from flatten helpers; thread `chapterNames` through `parseNavChapters` and `parseEpub` |
| `app/services/epub-parser.test.ts` | Add `chapterNames` assertions to existing chapter detection tests |
| `app/services/book-store.ts` | Migration v5: `chapter_names` column; update `BookRow`, `rowToBook`, `addBook`, `reimportBook` (×2) |
| `app/services/book-store.test.ts` | Update `FAKE_META`; add migration v5 test and `chapterNames` round-trip test |
| `app/routes/ui.ts` | Compute `currentChapterName` in `GET /api/my/progress` |
| `client/src/provider/progress/type.ts` | Add `currentChapterName?: string` |
| `client/src/control/chapter-progress/index.tsx` | Add `name?: string` prop; conditional display |
| `client/src/page/book/index.tsx` | Pass `progress.currentChapterName` to `ChapterProgress` |

---

## Task 1: Add `chapterNames` to types

**Files:**
- Modify: `app/types.ts`

- [ ] **Step 1: Add `chapterNames` to both interfaces**

In `app/types.ts`, add `chapterNames: string[]` after `chapterSpineMap` in both `Book` and `EpubMeta`:

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
}

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
}
```

- [ ] **Step 2: Verify TypeScript compilation catches missing fields**

Run:
```bash
npm run build 2>&1 | head -40
```

Expected: TypeScript errors about `chapterNames` missing in callers (epub-parser, book-store). This confirms the type is wired up correctly — we'll fix the callers in subsequent tasks.

---

## Task 2: Extend EPUB parser to extract chapter names

**Files:**
- Modify: `app/services/epub-parser.ts`

- [ ] **Step 1: Write failing test for EPUB 3 nav chapter names**

Add to the `chapter detection` describe block in `app/services/epub-parser.test.ts`:

```typescript
it('returns chapterNames from EPUB 3 nav document', () => {
  const filePath = path.join(tmpDir, 'epub3-names.epub');
  fs.writeFileSync(
    filePath,
    makeEpubWithNav([
      { title: 'The Beginning', href: 'ch1.xhtml' },
      { title: 'The Middle', href: 'ch2.xhtml' },
      { title: 'The End', href: 'ch3.xhtml' },
    ])
  );
  const meta = parseEpub(filePath);
  expect(meta.chapterNames).toEqual(['The Beginning', 'The Middle', 'The End']);
});

it('returns chapterNames from EPUB 2 NCX document', () => {
  const filePath = path.join(tmpDir, 'epub2-names.epub');
  fs.writeFileSync(
    filePath,
    makeEpubWithNcx([
      { title: 'Part One', href: 'ch1.xhtml' },
      { title: 'Part Two', href: 'ch2.xhtml' },
    ])
  );
  const meta = parseEpub(filePath);
  expect(meta.chapterNames).toEqual(['Part One', 'Part Two']);
});

it('returns empty chapterNames when no nav document present', () => {
  const filePath = path.join(tmpDir, 'no-nav-names.epub');
  fs.writeFileSync(filePath, makeEpub({ title: 'No Nav' }));
  const meta = parseEpub(filePath);
  expect(meta.chapterNames).toEqual([]);
});

it('deduplicates chapterNames to match deduplication of chapterSpineMap', () => {
  // Two nav entries pointing to the same spine item — only the first name is kept
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
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`)
  );
  zip.addFile(
    'OEBPS/nav.xhtml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="ch1.xhtml">Chapter 1</a></li>
        <li><a href="ch1.xhtml#section2">Section 2</a></li>
      </ol>
    </nav>
  </body>
</html>`)
  );
  zip.addFile('OEBPS/ch1.xhtml', Buffer.from('<html/>'));
  const filePath = path.join(tmpDir, 'dedup-names.epub');
  fs.writeFileSync(filePath, zip.toBuffer());
  const meta = parseEpub(filePath);
  expect(meta.chapterCount).toBe(1);
  expect(meta.chapterNames).toEqual(['Chapter 1']);
});
```

- [ ] **Step 2: Run failing tests**

```bash
npm test -- --testPathPattern="epub-parser" 2>&1 | tail -20
```

Expected: FAIL — `chapterNames` is undefined on the returned meta object.

- [ ] **Step 3: Update `flattenNavOl` to return `{href, title}` pairs**

Replace the entire `flattenNavOl` function in `app/services/epub-parser.ts`:

```typescript
function flattenNavOl(ol: unknown): { href: string; title: string }[] {
  if (!ol || typeof ol !== 'object') return [];
  const items = (ol as Record<string, unknown>).li;
  if (!items) return [];
  const result: { href: string; title: string }[] = [];
  for (const item of (Array.isArray(items) ? items : [items]) as Array<Record<string, unknown>>) {
    const aNode = item.a;
    if (aNode && typeof aNode === 'object') {
      const href = (aNode as Record<string, string>)['@_href'];
      const title = ((aNode as Record<string, string>)['#text'] ?? '').trim();
      if (href) result.push({ href, title });
    }
    if (item.ol) result.push(...flattenNavOl(item.ol));
  }
  return result;
}
```

- [ ] **Step 4: Update `flattenNcxNavPoints` to return `{href, title}` pairs**

Replace the entire `flattenNcxNavPoints` function:

```typescript
function flattenNcxNavPoints(navPoints: unknown[]): { href: string; title: string }[] {
  const result: { href: string; title: string }[] = [];
  for (const np of navPoints as Array<Record<string, unknown>>) {
    const src = (np.content as Record<string, string> | undefined)?.['@_src'];
    const navLabel = np.navLabel as Record<string, unknown> | undefined;
    const title = ((navLabel?.text as string | undefined) ?? '').trim();
    if (src) result.push({ href: src, title });
    if (np.navPoint) {
      const nested = Array.isArray(np.navPoint) ? np.navPoint : [np.navPoint];
      result.push(...flattenNcxNavPoints(nested as unknown[]));
    }
  }
  return result;
}
```

- [ ] **Step 5: Update `hrefsToSpineMap` to accept pairs and return names**

Replace the entire `hrefsToSpineMap` function:

```typescript
function hrefsToSpineMap(
  entries: { href: string; title: string }[],
  fileDir: string,
  spineHrefToIndex: Map<string, number>
): { spineMap: number[]; names: string[] } {
  const seen = new Set<number>();
  const spineMap: number[] = [];
  const names: string[] = [];
  for (const { href, title } of entries) {
    const rootRel = path.posix.join(fileDir, href.split('#')[0]);
    const idx = spineHrefToIndex.get(rootRel);
    if (idx !== undefined && !seen.has(idx)) {
      seen.add(idx);
      spineMap.push(idx);
      names.push(title);
    }
  }
  return { spineMap, names };
}
```

- [ ] **Step 6: Update `parseNavChapters` return type and call sites**

Replace the `parseNavChapters` function signature and body. The return type changes to `{ chapterCount: number; chapterSpineMap: number[]; chapterNames: string[] }` and all four call sites (`hrefsToSpineMap(hrefs, ...)`) now receive `{ spineMap, names }`:

```typescript
function parseNavChapters(
  zip: AdmZip,
  opfDir: string,
  manifest: Array<{
    '@_id': string;
    '@_href': string;
    '@_media-type': string;
    '@_properties'?: string;
  }>,
  spineHrefToIndex: Map<string, number>
): { chapterCount: number; chapterSpineMap: number[]; chapterNames: string[] } {
  const navParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    isArray: (name) => ['li', 'nav', 'navPoint'].includes(name),
  });

  // Try EPUB 3 nav document
  const navItem = manifest.find((i) => i['@_properties']?.split(' ').includes('nav'));
  if (navItem) {
    const navAbsHref = opfDir === '.' ? navItem['@_href'] : `${opfDir}/${navItem['@_href']}`;
    const navEntry = zip.getEntry(navAbsHref) ?? zip.getEntry(navItem['@_href']);
    if (navEntry) {
      const navDir = navAbsHref.includes('/')
        ? navAbsHref.substring(0, navAbsHref.lastIndexOf('/'))
        : '.';
      const doc = navParser.parse(navEntry.getData().toString('utf8')) as Record<string, unknown>;
      const navList = (doc?.html as Record<string, unknown>)?.body as { nav?: unknown } | undefined;
      const navArr = navList?.nav ? (Array.isArray(navList.nav) ? navList.nav : [navList.nav]) : [];
      const tocNav = (navArr as Array<Record<string, unknown>>).find((n) =>
        ((n['@_epub:type'] as string | undefined) ?? '').split(' ').includes('toc')
      );
      if (tocNav) {
        const entries = flattenNavOl(tocNav.ol);
        const { spineMap, names } = hrefsToSpineMap(entries, navDir, spineHrefToIndex);
        if (spineMap.length > 0)
          return { chapterCount: spineMap.length, chapterSpineMap: spineMap, chapterNames: names };
      }
    }
  }

  // Fall back to EPUB 2 NCX
  const ncxItem = manifest.find((i) => i['@_media-type'] === 'application/x-dtbncx+xml');
  if (ncxItem) {
    const ncxAbsHref = opfDir === '.' ? ncxItem['@_href'] : `${opfDir}/${ncxItem['@_href']}`;
    const ncxEntry = zip.getEntry(ncxAbsHref) ?? zip.getEntry(ncxItem['@_href']);
    if (ncxEntry) {
      const ncxDir = ncxAbsHref.includes('/')
        ? ncxAbsHref.substring(0, ncxAbsHref.lastIndexOf('/'))
        : '.';
      const doc = navParser.parse(ncxEntry.getData().toString('utf8')) as Record<string, unknown>;
      const navPoints: unknown[] =
        (((doc?.ncx as Record<string, unknown>)?.navMap as Record<string, unknown>)
          ?.navPoint as unknown[]) ?? [];
      const entries = flattenNcxNavPoints(navPoints);
      const { spineMap, names } = hrefsToSpineMap(entries, ncxDir, spineHrefToIndex);
      if (spineMap.length > 0)
        return { chapterCount: spineMap.length, chapterSpineMap: spineMap, chapterNames: names };
    }
  }

  return { chapterCount: 0, chapterSpineMap: [], chapterNames: [] };
}
```

- [ ] **Step 7: Thread `chapterNames` through `parseEpub`**

In `parseEpub`, update the destructuring of `parseNavChapters` result and the return value:

```typescript
  const { chapterCount, chapterSpineMap, chapterNames } = parseNavChapters(
    zip,
    opfDir,
    manifest,
    spineHrefToIndex
  );
```

And in the return object at the bottom of `parseEpub`, add `chapterNames`:

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

- [ ] **Step 8: Run parser tests**

```bash
npm test -- --testPathPattern="epub-parser" 2>&1 | tail -30
```

Expected: All tests pass, including the four new `chapterNames` tests.

- [ ] **Step 9: Commit**

```bash
git add app/types.ts app/services/epub-parser.ts app/services/epub-parser.test.ts
git commit -m "feat: extract chapter names from EPUB nav/NCX documents"
```

---

## Task 3: Store chapter names in the database

**Files:**
- Modify: `app/services/book-store.ts`
- Modify: `app/services/book-store.test.ts`

- [ ] **Step 1: Write failing test for migration v5**

Add to the `migrations` describe block in `app/services/book-store.test.ts`:

```typescript
it('migration v5: adds chapter_names column with NULL default', () => {
  const cols = db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
  const names = cols.map((c) => c.name);
  expect(names).toContain('chapter_names');
});
```

Also update `FAKE_META` (near the top of the test file) to include `chapterNames`:

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
};
```

Also add the `chapterNames` field to every inline meta literal in the test file. All mock `EpubMeta` objects returned by `makeMockImporter` and `makeImporterWithId` need `chapterNames: []` added. Here is the updated `makeMockImporter`:

```typescript
function makeMockImporter(): ScanImporter {
  return {
    parseEpub: (_filePath: string): EpubMeta => ({
      title: 'Mock Title',
      author: 'Mock Author',
      description: '',
      publisher: '',
      series: '',
      seriesIndex: 0,
      fileAs: '',
      identifiers: [],
      subjects: [],
      coverData: null,
      coverMime: null,
      chapterCount: 0,
      chapterSpineMap: [],
      chapterNames: [],
    }),
    partialMD5: (filePath: string): string =>
      crypto.createHash('md5').update(filePath).digest('hex'),
  };
}
```

And in `makeImporterWithId`:

```typescript
function makeImporterWithId(id: string): ScanImporter {
  return {
    parseEpub: (_p: string): EpubMeta => ({
      title: 'Book',
      author: '',
      description: '',
      publisher: '',
      series: '',
      seriesIndex: 0,
      fileAs: '',
      identifiers: [],
      subjects: [],
      coverData: null,
      coverMime: null,
      chapterCount: 0,
      chapterSpineMap: [],
      chapterNames: [],
    }),
    partialMD5: (_p: string): string => id,
  };
}
```

Also add a chapterNames round-trip test to the `addBook and listBooks` describe block:

```typescript
it('stores and retrieves chapterNames (JSON round-trip)', () => {
  bookStore.addBook('ch1', 'named.epub', '/books/named.epub', 100, new Date(), {
    ...FAKE_META,
    chapterCount: 2,
    chapterSpineMap: [1, 2],
    chapterNames: ['The Storm', 'The Calm'],
  });
  const book = bookStore.getBookById('ch1');
  expect(book?.chapterNames).toEqual(['The Storm', 'The Calm']);
});

it('returns empty chapterNames array when column is NULL (pre-migration books)', () => {
  // Simulate a pre-migration book: insert a row without chapter_names
  db.prepare(
    `INSERT INTO books (id, filename, path, title, size, mtime, added_at, chapter_count, chapter_spine_map)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('old-book', 'old.epub', '/books/old.epub', 'Old Book', 100, 0, 0, 0, '[]');
  const book = bookStore.getBookById('old-book');
  expect(book?.chapterNames).toEqual([]);
});
```

- [ ] **Step 2: Run failing tests**

```bash
npm test -- --testPathPattern="book-store" 2>&1 | tail -20
```

Expected: FAIL — `chapterNames` property missing, TypeScript errors, `chapter_names` column not found.

- [ ] **Step 3: Add migration v5 to `book-store.ts`**

Add `BookRow` field and migration v5 block. In `book-store.ts`:

First, add `chapter_names: string | null` to the `BookRow` interface:

```typescript
interface BookRow {
  id: string;
  filename: string;
  path: string;
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
}
```

Then add migration v5 after the existing `if (user_version < 4)` block:

```typescript
    if (user_version < 5) {
      const cols = this.db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'chapter_names')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN chapter_names TEXT`);
      }
      this.db.exec('PRAGMA user_version = 5');
    }
```

- [ ] **Step 4: Update `rowToBook` to parse `chapter_names`**

In the `rowToBook` method, add `chapterNames` to the returned object:

```typescript
  private rowToBook(r: BookRow): Book {
    const fileAs = r.file_as;
    return {
      id: r.id,
      filename: r.filename,
      path: r.path,
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

- [ ] **Step 5: Update `addBook` to write `chapter_names`**

In `addBook`, update the INSERT statement and `.run()` call to include `chapter_names`:

Replace the INSERT SQL string (the `stmt` declaration) with:

```typescript
    const stmt = this.db.prepare(`
      INSERT INTO books (id, filename, path, title, file_as, author, description, publisher, series, series_index, identifiers, subjects, cover_data, cover_mime, size, mtime, added_at, chapter_count, chapter_spine_map, chapter_names)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(filename) DO UPDATE SET
        id = excluded.id,
        path = excluded.path,
        title = excluded.title,
        file_as = excluded.file_as,
        author = excluded.author,
        description = excluded.description,
        publisher = excluded.publisher,
        series = excluded.series,
        series_index = excluded.series_index,
        identifiers = excluded.identifiers,
        subjects = excluded.subjects,
        cover_data = excluded.cover_data,
        cover_mime = excluded.cover_mime,
        size = excluded.size,
        mtime = excluded.mtime,
        chapter_count = excluded.chapter_count,
        chapter_spine_map = excluded.chapter_spine_map,
        chapter_names = excluded.chapter_names
    `);
```

And add `JSON.stringify(meta.chapterNames)` as the last argument in the `.run()` call:

```typescript
    stmt.run(
      id,
      filename,
      filePath,
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
      size,
      mtime.getTime(),
      Date.now(),
      meta.chapterCount,
      JSON.stringify(meta.chapterSpineMap),
      JSON.stringify(meta.chapterNames)
    );
```

- [ ] **Step 6: Update `reimportBook` — both UPDATE branches**

In `reimportBook`, there are two UPDATE statements (one when ID changes, one when it stays the same). Add `chapter_names=?` to both SQL strings and `JSON.stringify(meta.chapterNames)` as the corresponding argument before the final `id` parameter.

**Branch 1 (ID changes):** Replace the UPDATE SQL and `.run()`:

```typescript
        this.db
          .prepare(
            `UPDATE books SET id=?, title=?, file_as=?, author=?, description=?, publisher=?,
             series=?, series_index=?, identifiers=?, subjects=?, cover_data=?, cover_mime=?,
             size=?, mtime=?, chapter_count=?, chapter_spine_map=?, chapter_names=? WHERE id=?`
          )
          .run(
            newId,
            meta.title.trim() || path.basename(row.filename, path.extname(row.filename)),
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
            id
          );
```

**Branch 2 (same ID):** Replace the UPDATE SQL and `.run()`:

```typescript
        this.db
          .prepare(
            `UPDATE books SET title=?, file_as=?, author=?, description=?, publisher=?,
             series=?, series_index=?, identifiers=?, subjects=?, cover_data=?, cover_mime=?,
             size=?, mtime=?, chapter_count=?, chapter_spine_map=?, chapter_names=? WHERE id=?`
          )
          .run(
            meta.title.trim() || path.basename(row.filename, path.extname(row.filename)),
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
            id
          );
```

- [ ] **Step 7: Update SELECT statements to include `chapter_names`**

In `listBooks`, update the SELECT query:

```typescript
      .prepare(
        `
      SELECT id, filename, path, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map, chapter_names
      FROM books
      ORDER BY CASE WHEN file_as != '' THEN file_as ELSE title END, title, filename
    `
      )
```

In `getBookById`, update the SELECT query:

```typescript
      .prepare(
        `
      SELECT id, filename, path, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map, chapter_names
      FROM books WHERE id = ?
    `
      )
```

- [ ] **Step 8: Run book-store tests**

```bash
npm test -- --testPathPattern="book-store" 2>&1 | tail -30
```

Expected: All tests pass.

- [ ] **Step 9: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add app/services/book-store.ts app/services/book-store.test.ts
git commit -m "feat: add chapter_names column (migration v5) and persist chapter names"
```

---

## Task 4: Include `currentChapterName` in the progress API response

**Files:**
- Modify: `app/routes/ui.ts`

- [ ] **Step 1: Update the `GET /api/my/progress` handler**

In `app/routes/ui.ts`, find the `GET /api/my/progress` handler and replace the `return` object inside the `.map()` callback:

Current code:
```typescript
        const currentChapter =
          spineIndex !== null && book && book.chapterSpineMap.length > 0
            ? (spineIndexToChapter(spineIndex, book.chapterSpineMap) ?? undefined)
            : undefined;
        return {
          document: p.document,
          percentage: p.percentage,
          ...(currentChapter !== undefined ? { currentChapter } : {}),
        };
```

Replace with:
```typescript
        const currentChapter =
          spineIndex !== null && book && book.chapterSpineMap.length > 0
            ? (spineIndexToChapter(spineIndex, book.chapterSpineMap) ?? undefined)
            : undefined;
        const currentChapterName =
          currentChapter !== undefined && book && book.chapterNames.length > 0
            ? (book.chapterNames[currentChapter - 1] || undefined)
            : undefined;
        return {
          document: p.document,
          percentage: p.percentage,
          ...(currentChapter !== undefined ? { currentChapter } : {}),
          ...(currentChapterName !== undefined ? { currentChapterName } : {}),
        };
```

- [ ] **Step 2: Run lint**

```bash
npm run lint 2>&1 | tail -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/routes/ui.ts
git commit -m "feat: include currentChapterName in GET /api/my/progress response"
```

---

## Task 5: Add `currentChapterName` to the client Progress type

**Files:**
- Modify: `client/src/provider/progress/type.ts`

- [ ] **Step 1: Add the optional field**

Replace the contents of `client/src/provider/progress/type.ts`:

```typescript
export type ProgressList = Record<string, UserProgressList>;
export type UserProgressList = Record<string, Progress>;

export type Progress = {
  document: string;
  percentage: number;
  device?: string; // present on GET /api/users/:username/progress (admin), absent on GET /api/my/progress
  timestamp?: number; // present on GET /api/users/:username/progress (admin), absent on GET /api/my/progress
  currentChapter?: number;
  currentChapterName?: string;
};
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors (the field is optional, so no existing callers break).

- [ ] **Step 3: Commit**

```bash
git add client/src/provider/progress/type.ts
git commit -m "feat: add currentChapterName to client Progress type"
```

---

## Task 6: Update `ChapterProgress` component to display chapter name

**Files:**
- Modify: `client/src/control/chapter-progress/index.tsx`

- [ ] **Step 1: Update the component**

Replace the contents of `client/src/control/chapter-progress/index.tsx`:

```typescript
import { ListCheckIcon } from '~/icon';

import { useStyle } from './style';

type ChapterProgressProps = {
  current: number;
  total: number;
  name?: string;
};

export const ChapterProgress = ({ current, total, name }: ChapterProgressProps) => {
  const style = useStyle();

  return (
    <div className={style.root}>
      <span className={style.title}>Chapters:</span>
      <ListCheckIcon width={12} height={12} strokeWidth={2.5} />
      <span className={style.label}>
        {name ? `Ch ${current}: ${name} / ${total}` : `Ch ${current} / ${total}`}
      </span>
    </div>
  );
};
```

- [ ] **Step 2: Update the book page to pass the name**

In `client/src/page/book/index.tsx`, find the `<ChapterProgress>` usage and add the `name` prop:

```typescript
              <ChapterProgress
                current={progress.currentChapter}
                total={book.chapterCount}
                name={progress.currentChapterName}
              />
```

- [ ] **Step 3: Build the client to verify no TypeScript errors**

```bash
cd client && npm run build 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Run full test suite**

```bash
cd .. && npm test 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 5: Run lint**

```bash
npm run lint 2>&1 | tail -20
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/control/chapter-progress/index.tsx client/src/page/book/index.tsx
git commit -m "feat: display chapter name in ChapterProgress control"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| EPUB parser extracts chapter titles | Task 2 |
| `chapterNames: string[]` in `Book` and `EpubMeta` | Task 1 |
| DB migration v5 `chapter_names` column | Task 3 |
| `rowToBook` handles NULL → `[]` | Task 3, Step 4 |
| `addBook` / `reimportBook` serialize names | Task 3, Steps 5–6 |
| `GET /api/my/progress` includes `currentChapterName` | Task 4 |
| `currentChapterName` omitted when absent/falsy | Task 4 |
| Client `Progress` type has `currentChapterName?: string` | Task 5 |
| `ChapterProgress` shows "Ch 5: The Storm / 24" with name | Task 6 |
| `ChapterProgress` shows "Ch 5 / 24" without name | Task 6 |
| `name` passed from book page | Task 6, Step 2 |

**Placeholder scan:** No TBDs or TODOs in plan.

**Type consistency:** `chapterNames` (plural) used throughout. `currentChapterName` (singular) used for the single resolved name in API + Progress type + component prop. Consistent.

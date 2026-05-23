# Chapter Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse chapter count from EPUB nav documents at import time, expose it on the book API, and compute the current chapter server-side from KoSync's CFI string, returning it on the progress API — wiring both values into the `ChapterProgress` component and book metadata on the Book page.

**Architecture:** Chapter data (count + spine-to-chapter map) is extracted from the EPUB nav document during `parseEpub`, stored in two new DB columns, and stripped from the public book API (except `chapterCount`). The progress API joins with the books table to resolve the stored CFI into a 1-based `currentChapter` using a new CFI utility module.

**Tech Stack:** TypeScript, Node.js, better-sqlite3, AdmZip, fast-xml-parser, React, Jotai (via existing providers)

**Spec:** `docs/superpowers/specs/2026-05-16-chapter-count-design.md`

---

## File Map

| Status | File | Change |
|---|---|---|
| Modify | `app/types.ts` | Add `chapterCount`, `chapterSpineMap` to `EpubMeta` and `Book` |
| Modify | `app/services/epub-parser.ts` | Add nav/NCX parsing helpers and call them from `parseEpub` |
| Modify | `app/services/epub-parser.test.ts` | Add chapter detection tests + update `makeEpub` to accept nav opts |
| Modify | `app/services/book-store.ts` | Migration v4, update `addBook`, `reimportBook`, `rowToBook`, queries |
| Modify | `app/services/book-store.test.ts` | Update `FAKE_META` + `makeMockImporter`; add chapter storage tests |
| Create | `app/utils/cfi.ts` | `parseCfiSpineIndex` and `spineIndexToChapter` |
| Create | `app/utils/cfi.test.ts` | Unit tests for CFI utilities |
| Modify | `app/routes/ui.ts` | Strip `chapterSpineMap` from book responses; add `currentChapter` to progress response |
| Modify | `app/routes/ui.test.ts` | Update `FAKE_META`; add `currentChapter` and `chapterCount` API tests |
| Modify | `client/src/provider/book/type.ts` | Add `chapterCount: number` |
| Modify | `client/src/provider/progress/type.ts` | Add `currentChapter?: number` |
| Modify | `client/src/page/book/index.tsx` | Add chapters metadata entry; wire real values into `ChapterProgress` |

---

## Task 1: Extend server types and fix all test fixtures

**Files:**
- Modify: `app/types.ts`
- Modify: `app/services/book-store.test.ts:34-46` (FAKE_META)
- Modify: `app/services/book-store.test.ts:242-260` (makeMockImporter)
- Modify: `app/routes/ui.test.ts:44-56` (FAKE_META)

- [ ] **Step 1: Add `chapterCount` and `chapterSpineMap` to `EpubMeta` and `Book` in `app/types.ts`**

Replace the existing `EpubMeta` and `Book` interfaces with:

```ts
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
}
```

- [ ] **Step 2: Update `FAKE_META` in `app/services/book-store.test.ts`**

Find the `FAKE_META` constant (around line 34) and add the two new fields:

```ts
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
};
```

- [ ] **Step 3: Update `makeMockImporter` in `app/services/book-store.test.ts`**

Find `makeMockImporter` (around line 242) and add the two new fields to the returned meta:

```ts
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
    }),
    partialMD5: (filePath: string): string =>
      crypto.createHash('md5').update(filePath).digest('hex'),
  };
}
```

- [ ] **Step 4: Update `FAKE_META` in `app/routes/ui.test.ts`**

Find the `FAKE_META` constant (around line 44) and add the two new fields:

```ts
const FAKE_META: EpubMeta = {
  title: 'Test Book',
  author: 'Test Author',
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
};
```

Also update all inline `EpubMeta` objects inside `scan` test cases (search for `coverData: null` inside `errorImporter` and ghost book meta literal in `book-store.test.ts`) — any object literal typed as `EpubMeta` that is missing the new fields needs them added with `chapterCount: 0, chapterSpineMap: []`.

- [ ] **Step 5: Run tests to verify they still compile and pass**

```
npm test
```

Expected: all existing tests pass (the new fields have no runtime effect yet).

- [ ] **Step 6: Commit**

```bash
git add app/types.ts app/services/book-store.test.ts app/routes/ui.test.ts
git commit -m "feat: add chapterCount and chapterSpineMap to server Book and EpubMeta types"
```

---

## Task 2: Parse EPUB nav chapters in `epub-parser.ts`

**Files:**
- Modify: `app/services/epub-parser.test.ts` (add tests)
- Modify: `app/services/epub-parser.ts` (implement)

- [ ] **Step 1: Add EPUB test helpers to `app/services/epub-parser.test.ts`**

Add these two helper functions after the existing `makeEpub` function (before `let tmpDir`):

```ts
function makeEpubWithNav(chapters: Array<{ title: string; href: string }>): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
  );

  const manifestItems = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
    ...chapters.map((c, i) => `<item id="ch${i}" href="${c.href}" media-type="application/xhtml+xml"/>`),
  ].join('\n    ');

  const spineRefs = [
    `<itemref idref="cover"/>`,
    ...chapters.map((_, i) => `<itemref idref="ch${i}"/>`),
  ].join('\n    ');

  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title></metadata>
  <manifest>${manifestItems}</manifest>
  <spine>${spineRefs}</spine>
</package>`)
  );

  const navItems = chapters.map((c) => `<li><a href="${c.href}">${c.title}</a></li>`).join('\n        ');
  zip.addFile(
    'OEBPS/nav.xhtml',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        ${navItems}
      </ol>
    </nav>
  </body>
</html>`)
  );

  for (const chapter of chapters) {
    zip.addFile(`OEBPS/${chapter.href}`, Buffer.from(`<html><body><p>${chapter.title}</p></body></html>`));
  }
  zip.addFile('OEBPS/cover.xhtml', Buffer.from('<html><body>Cover</body></html>'));

  return zip.toBuffer();
}

function makeEpubWithNcx(chapters: Array<{ title: string; href: string }>): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
  );

  const manifestItems = [
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
    ...chapters.map((c, i) => `<item id="ch${i}" href="${c.href}" media-type="application/xhtml+xml"/>`),
  ].join('\n    ');

  const spineRefs = [
    `<itemref idref="cover"/>`,
    ...chapters.map((_, i) => `<itemref idref="ch${i}"/>`),
  ].join('\n    ');

  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title></metadata>
  <manifest>${manifestItems}</manifest>
  <spine toc="ncx">${spineRefs}</spine>
</package>`)
  );

  const navPoints = chapters
    .map(
      (c, i) => `<navPoint id="np${i}" playOrder="${i + 1}">
      <navLabel><text>${c.title}</text></navLabel>
      <content src="${c.href}"/>
    </navPoint>`
    )
    .join('\n    ');

  zip.addFile(
    'OEBPS/toc.ncx',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`)
  );

  for (const chapter of chapters) {
    zip.addFile(`OEBPS/${chapter.href}`, Buffer.from(`<html><body><p>${chapter.title}</p></body></html>`));
  }
  zip.addFile('OEBPS/cover.xhtml', Buffer.from('<html><body>Cover</body></html>'));

  return zip.toBuffer();
}
```

- [ ] **Step 2: Add failing chapter detection tests to `app/services/epub-parser.test.ts`**

Add this new `describe` block at the end of the `describe('parseEpub', ...)` block (before its closing `}`):

```ts
describe('chapter detection', () => {
  it('returns chapterCount 0 and empty chapterSpineMap when no nav document present', () => {
    const filePath = path.join(tmpDir, 'no-nav.epub');
    fs.writeFileSync(filePath, makeEpub({ title: 'No Nav' }));
    const meta = parseEpub(filePath);
    expect(meta.chapterCount).toBe(0);
    expect(meta.chapterSpineMap).toEqual([]);
  });

  it('parses chapter count from EPUB 3 nav document', () => {
    const filePath = path.join(tmpDir, 'epub3-nav.epub');
    fs.writeFileSync(
      filePath,
      makeEpubWithNav([
        { title: 'Chapter 1', href: 'ch1.xhtml' },
        { title: 'Chapter 2', href: 'ch2.xhtml' },
        { title: 'Chapter 3', href: 'ch3.xhtml' },
      ])
    );
    const meta = parseEpub(filePath);
    expect(meta.chapterCount).toBe(3);
    // spine: cover(0), ch1(1), ch2(2), ch3(3) — nav entries map to indices 1, 2, 3
    expect(meta.chapterSpineMap).toEqual([1, 2, 3]);
  });

  it('parses chapter count from EPUB 2 NCX document', () => {
    const filePath = path.join(tmpDir, 'epub2-ncx.epub');
    fs.writeFileSync(
      filePath,
      makeEpubWithNcx([
        { title: 'Chapter 1', href: 'ch1.xhtml' },
        { title: 'Chapter 2', href: 'ch2.xhtml' },
      ])
    );
    const meta = parseEpub(filePath);
    expect(meta.chapterCount).toBe(2);
    expect(meta.chapterSpineMap).toEqual([1, 2]);
  });

  it('flattens nested nav entries', () => {
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
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="sec2a" href="sec2a.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="sec2a"/>
    <itemref idref="ch3"/>
  </spine>
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
        <li>
          <a href="ch2.xhtml">Chapter 2</a>
          <ol>
            <li><a href="sec2a.xhtml">Section 2a</a></li>
          </ol>
        </li>
        <li><a href="ch3.xhtml">Chapter 3</a></li>
      </ol>
    </nav>
  </body>
</html>`)
    );
    ['cover.xhtml', 'ch1.xhtml', 'ch2.xhtml', 'sec2a.xhtml', 'ch3.xhtml'].forEach((f) =>
      zip.addFile(`OEBPS/${f}`, Buffer.from('<html/>'))
    );

    const filePath = path.join(tmpDir, 'nested-nav.epub');
    fs.writeFileSync(filePath, zip.toBuffer());
    const meta = parseEpub(filePath);
    // spine: cover(0) ch1(1) ch2(2) sec2a(3) ch3(4)
    expect(meta.chapterCount).toBe(4);
    expect(meta.chapterSpineMap).toEqual([1, 2, 3, 4]);
  });

  it('deduplicates nav entries that reference the same spine item', () => {
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
    // Two nav entries pointing to the same file (one with a fragment)
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

    const filePath = path.join(tmpDir, 'dedup.epub');
    fs.writeFileSync(filePath, zip.toBuffer());
    const meta = parseEpub(filePath);
    expect(meta.chapterCount).toBe(1);
    expect(meta.chapterSpineMap).toEqual([0]);
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

```
npm test -- --testPathPattern=epub-parser
```

Expected: the new `chapter detection` tests fail with errors like `expect(received).toBe(0)` or `TypeError: meta.chapterCount is undefined`.

- [ ] **Step 4: Implement nav chapter parsing in `app/services/epub-parser.ts`**

After the existing imports (after `import { EpubMeta } from '../types';`), add the three helper functions and the main parsing function. Add them between the `PARTIAL_MD5_OFFSETS` block and the `type MetaLike` line:

```ts
function flattenNavOl(ol: unknown): string[] {
  if (!ol || typeof ol !== 'object') return [];
  const items = (ol as Record<string, unknown>).li;
  if (!items) return [];
  const result: string[] = [];
  for (const item of (Array.isArray(items) ? items : [items]) as Array<Record<string, unknown>>) {
    const aNode = item.a;
    if (aNode && typeof aNode === 'object') {
      const href = (aNode as Record<string, string>)['@_href'];
      if (href) result.push(href);
    }
    if (item.ol) result.push(...flattenNavOl(item.ol));
  }
  return result;
}

function flattenNcxNavPoints(navPoints: unknown[]): string[] {
  const result: string[] = [];
  for (const np of navPoints as Array<Record<string, unknown>>) {
    const src = (np.content as Record<string, string> | undefined)?.['@_src'];
    if (src) result.push(src);
    if (np.navPoint) {
      const nested = Array.isArray(np.navPoint) ? np.navPoint : [np.navPoint];
      result.push(...flattenNcxNavPoints(nested as unknown[]));
    }
  }
  return result;
}

function hrefsToSpineMap(
  hrefs: string[],
  fileDir: string,
  spineHrefToIndex: Map<string, number>
): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const href of hrefs) {
    const rootRel = path.posix.join(fileDir, href.split('#')[0]);
    const idx = spineHrefToIndex.get(rootRel);
    if (idx !== undefined && !seen.has(idx)) {
      seen.add(idx);
      result.push(idx);
    }
  }
  return result;
}

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
): { chapterCount: number; chapterSpineMap: number[] } {
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
      const navList = (doc?.html as Record<string, unknown>)?.body as
        | { nav?: unknown }
        | undefined;
      const navArr = navList?.nav
        ? Array.isArray(navList.nav)
          ? navList.nav
          : [navList.nav]
        : [];
      const tocNav = (navArr as Array<Record<string, unknown>>).find((n) =>
        ((n['@_epub:type'] as string | undefined) ?? '').split(' ').includes('toc')
      );
      if (tocNav) {
        const hrefs = flattenNavOl(tocNav.ol);
        const spineMap = hrefsToSpineMap(hrefs, navDir, spineHrefToIndex);
        if (spineMap.length > 0) return { chapterCount: spineMap.length, chapterSpineMap: spineMap };
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
        ((doc?.ncx as Record<string, unknown>)?.navMap as Record<string, unknown>)
          ?.navPoint as unknown[] ?? [];
      const hrefs = flattenNcxNavPoints(navPoints);
      const spineMap = hrefsToSpineMap(hrefs, ncxDir, spineHrefToIndex);
      if (spineMap.length > 0) return { chapterCount: spineMap.length, chapterSpineMap: spineMap };
    }
  }

  return { chapterCount: 0, chapterSpineMap: [] };
}
```

- [ ] **Step 5: Wire `parseNavChapters` into `parseEpub`**

In `parseEpub`, after the line `const manifest: Array<...> = pkg?.manifest?.item ?? [];` (around line 108), add the spine index map construction and the chapter parsing call. Insert this block before "Step 3: extract metadata":

```ts
  // Build spine href → 0-based spine index map (used for chapter detection)
  const rawSpineRefs = pkg?.spine?.itemref ?? [];
  const spineItemRefs: Array<{ '@_idref': string }> = Array.isArray(rawSpineRefs)
    ? (rawSpineRefs as Array<{ '@_idref': string }>)
    : [rawSpineRefs as { '@_idref': string }];
  const hrefByManifestId = new Map<string, string>();
  for (const item of manifest) {
    hrefByManifestId.set(item['@_id'], item['@_href']);
  }
  const spineHrefToIndex = new Map<string, number>();
  for (let i = 0; i < spineItemRefs.length; i++) {
    const href = hrefByManifestId.get(spineItemRefs[i]['@_idref']);
    if (href) {
      spineHrefToIndex.set(opfDir === '.' ? href : `${opfDir}/${href}`, i);
    }
  }
  const { chapterCount, chapterSpineMap } = parseNavChapters(zip, opfDir, manifest, spineHrefToIndex);
```

Then update the `return` statement at the bottom of `parseEpub` to include the new fields:

```ts
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
  };
```

- [ ] **Step 6: Run the tests to verify they pass**

```
npm test -- --testPathPattern=epub-parser
```

Expected: all tests pass, including the new `chapter detection` describe block.

- [ ] **Step 7: Commit**

```bash
git add app/services/epub-parser.ts app/services/epub-parser.test.ts
git commit -m "feat: parse chapter count and spine map from EPUB nav/NCX documents"
```

---

## Task 3: DB migration v4 and BookStore updates

**Files:**
- Modify: `app/services/book-store.test.ts` (add tests)
- Modify: `app/services/book-store.ts` (implement)

- [ ] **Step 1: Add failing chapter storage tests to `app/services/book-store.test.ts`**

Add a new `describe` block after the `describe('publisher, identifiers, subjects', ...)` block:

```ts
describe('chapter data', () => {
  it('DB migration adds chapter_count and chapter_spine_map columns', () => {
    const cols = db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('chapter_count');
    expect(names).toContain('chapter_spine_map');
  });

  it('stores and retrieves chapterCount', () => {
    bookStore.addBook('id1', 'book.epub', '/books/book.epub', 100, new Date(), {
      ...FAKE_META,
      chapterCount: 12,
      chapterSpineMap: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
    const book = bookStore.getBookById('id1');
    expect(book?.chapterCount).toBe(12);
  });

  it('stores and retrieves chapterSpineMap (JSON round-trip)', () => {
    const spineMap = [2, 4, 6, 8];
    bookStore.addBook('id2', 'map.epub', '/books/map.epub', 100, new Date(), {
      ...FAKE_META,
      chapterCount: 4,
      chapterSpineMap: spineMap,
    });
    const book = bookStore.getBookById('id2');
    expect(book?.chapterSpineMap).toEqual(spineMap);
  });

  it('defaults to chapterCount 0 and empty chapterSpineMap', () => {
    bookStore.addBook('id3', 'default.epub', '/books/default.epub', 100, new Date(), FAKE_META);
    const book = bookStore.getBookById('id3');
    expect(book?.chapterCount).toBe(0);
    expect(book?.chapterSpineMap).toEqual([]);
  });
});
```

Also add a migration test inside the existing `describe('migrations', ...)` block:

```ts
  it('migration v4: adds chapter_count and chapter_spine_map columns to existing table', () => {
    const preDb = new Database(':memory:');
    preDb.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, path TEXT NOT NULL,
        title TEXT NOT NULL, file_as TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '', publisher TEXT NOT NULL DEFAULT '',
        series TEXT NOT NULL DEFAULT '', series_index REAL NOT NULL DEFAULT 0,
        identifiers TEXT NOT NULL DEFAULT '[]', subjects TEXT NOT NULL DEFAULT '[]',
        cover_data BLOB, cover_mime TEXT,
        size INTEGER NOT NULL, mtime INTEGER NOT NULL, added_at INTEGER NOT NULL
      )
    `);
    preDb.exec('PRAGMA user_version = 3');

    new BookStore(booksDir, preDb);

    const cols = preDb.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('chapter_count');
    expect(names).toContain('chapter_spine_map');
    expect(preDb.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 4 });

    preDb.close();
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

```
npm test -- --testPathPattern=book-store
```

Expected: the `chapter data` tests and the `migration v4` test fail.

- [ ] **Step 3: Update `BookRow` interface in `app/services/book-store.ts`**

Find the `interface BookRow` (around line 10) and add two fields:

```ts
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
  size: number;
  mtime: number;
  added_at: number;
  chapter_count: number;
  chapter_spine_map: string;
}
```

- [ ] **Step 4: Add migration v4 to `migrate()` in `app/services/book-store.ts`**

At the end of the `migrate()` method, after the `if (user_version < 3)` block, add:

```ts
    if (user_version < 4) {
      const cols = this.db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has('chapter_count')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN chapter_count INTEGER NOT NULL DEFAULT 0`);
      }
      if (!colNames.has('chapter_spine_map')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN chapter_spine_map TEXT NOT NULL DEFAULT '[]'`);
      }
      this.db.exec('PRAGMA user_version = 4');
    }
```

- [ ] **Step 5: Update the `SELECT` queries in `listBooks` and `getBookById`**

In `listBooks`, replace the SELECT statement with:

```ts
    const rows = this.db
      .prepare(
        `
      SELECT id, filename, path, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map
      FROM books
      ORDER BY CASE WHEN file_as != '' THEN file_as ELSE title END, title, filename
    `
      )
      .all() as BookRow[];
```

In `getBookById`, replace the SELECT statement with:

```ts
    const row = this.db
      .prepare(
        `
      SELECT id, filename, path, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map
      FROM books WHERE id = ?
    `
      )
      .get(id) as BookRow | undefined;
```

- [ ] **Step 6: Update `addBook` to store chapter data**

Replace the INSERT statement in `addBook` with:

```ts
    const stmt = this.db.prepare(`
      INSERT INTO books (id, filename, path, title, file_as, author, description, publisher, series, series_index, identifiers, subjects, cover_data, cover_mime, size, mtime, added_at, chapter_count, chapter_spine_map)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        chapter_spine_map = excluded.chapter_spine_map
    `);
```

And replace the `stmt.run(...)` call with:

```ts
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
      JSON.stringify(meta.chapterSpineMap)
    );
```

- [ ] **Step 7: Update both UPDATE statements in `reimportBook`**

There are two UPDATE statements in `reimportBook` (one for when the ID changes, one for when it stays the same). Add `chapter_count=?, chapter_spine_map=?` to both, and add the corresponding values to both `.run(...)` calls.

First statement (ID changes — `newId !== id` branch):

```ts
          this.db
            .prepare(
              `UPDATE books SET id=?, title=?, file_as=?, author=?, description=?, publisher=?,
               series=?, series_index=?, identifiers=?, subjects=?, cover_data=?, cover_mime=?,
               size=?, mtime=?, chapter_count=?, chapter_spine_map=? WHERE id=?`
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
              id
            );
```

Second statement (ID stays — `else` branch):

```ts
        this.db
          .prepare(
            `UPDATE books SET title=?, file_as=?, author=?, description=?, publisher=?,
             series=?, series_index=?, identifiers=?, subjects=?, cover_data=?, cover_mime=?,
             size=?, mtime=?, chapter_count=?, chapter_spine_map=? WHERE id=?`
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
            id
          );
```

- [ ] **Step 8: Update `rowToBook` to map the new columns**

Add the two new fields to the returned object in `rowToBook`:

```ts
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
    };
  }
```

- [ ] **Step 9: Run tests to verify they pass**

```
npm test -- --testPathPattern=book-store
```

Expected: all tests pass, including the new `chapter data` and `migration v4` tests.

- [ ] **Step 10: Commit**

```bash
git add app/services/book-store.ts app/services/book-store.test.ts
git commit -m "feat: store chapter_count and chapter_spine_map in books table (migration v4)"
```

---

## Task 4: CFI parsing utility

**Files:**
- Create: `app/utils/cfi.ts`
- Create: `app/utils/cfi.test.ts`

- [ ] **Step 1: Write the failing tests in `app/utils/cfi.test.ts`**

Create the file with this content:

```ts
import { parseCfiSpineIndex, spineIndexToChapter } from './cfi';

describe('parseCfiSpineIndex', () => {
  it('parses standard KoReader CFI format', () => {
    // /6/4 → (4-2)/2 = 1
    expect(parseCfiSpineIndex('EPUB_CFI(/6/4[ch1]!/4/2/1:0)')).toBe(1);
  });

  it('parses CFI for the first spine item', () => {
    // /6/2 → (2-2)/2 = 0
    expect(parseCfiSpineIndex('EPUB_CFI(/6/2!/4/1:0)')).toBe(0);
  });

  it('parses CFI for a later spine item', () => {
    // /6/10 → (10-2)/2 = 4
    expect(parseCfiSpineIndex('EPUB_CFI(/6/10[chapter5]!/4/2/1:0)')).toBe(4);
  });

  it('returns null for a non-EPUB_CFI string', () => {
    expect(parseCfiSpineIndex('/p[1]')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseCfiSpineIndex('')).toBeNull();
  });

  it('returns null for an odd N (invalid CFI element index)', () => {
    expect(parseCfiSpineIndex('EPUB_CFI(/6/3!/4/1:0)')).toBeNull();
  });

  it('returns null for N less than 2', () => {
    expect(parseCfiSpineIndex('EPUB_CFI(/6/0!/4/1:0)')).toBeNull();
  });
});

describe('spineIndexToChapter', () => {
  it('returns 1 when spine index matches first chapter exactly', () => {
    expect(spineIndexToChapter(1, [1, 3, 5])).toBe(1);
  });

  it('returns the correct chapter when spine index is within a chapter range', () => {
    // spine 4 is between ch2(3) and ch3(5), so chapter 2
    expect(spineIndexToChapter(4, [1, 3, 5])).toBe(2);
  });

  it('returns the last chapter when spine index is past the last entry', () => {
    expect(spineIndexToChapter(10, [1, 3, 5])).toBe(3);
  });

  it('returns null for an empty spine map', () => {
    expect(spineIndexToChapter(5, [])).toBeNull();
  });

  it('returns null when spine index is before the first chapter entry', () => {
    // spine 0 is before ch1(1)
    expect(spineIndexToChapter(0, [1, 3, 5])).toBeNull();
  });

  it('returns correct chapter with a single chapter', () => {
    expect(spineIndexToChapter(2, [2])).toBe(1);
    expect(spineIndexToChapter(5, [2])).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```
npm test -- --testPathPattern=cfi
```

Expected: fails because `app/utils/cfi.ts` does not exist.

- [ ] **Step 3: Create `app/utils/cfi.ts`**

```ts
export function parseCfiSpineIndex(cfi: string): number | null {
  const match = /^EPUB_CFI\(\/6\/(\d+)/.exec(cfi);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  if (n < 2 || n % 2 !== 0) return null;
  return (n - 2) / 2;
}

export function spineIndexToChapter(spineIndex: number, chapterSpineMap: number[]): number | null {
  if (chapterSpineMap.length === 0) return null;
  let chapterIndex = -1;
  for (let i = 0; i < chapterSpineMap.length; i++) {
    if (chapterSpineMap[i] <= spineIndex) chapterIndex = i;
  }
  return chapterIndex >= 0 ? chapterIndex + 1 : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm test -- --testPathPattern=cfi
```

Expected: all 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/utils/cfi.ts app/utils/cfi.test.ts
git commit -m "feat: add CFI spine index and chapter mapping utilities"
```

---

## Task 5: Update book and progress API routes

**Files:**
- Modify: `app/routes/ui.test.ts` (add tests)
- Modify: `app/routes/ui.ts` (implement)

- [ ] **Step 1: Add failing tests for the book API (chapterCount exposed, chapterSpineMap hidden)**

Inside the existing `describe('GET /api/books', ...)` block in `app/routes/ui.test.ts`, add:

```ts
  it('includes chapterCount in the book list response', async () => {
    bookStore.addBook('id-ch', 'chaptered.epub', path.join(booksDir, 'chaptered.epub'), 100, new Date(), {
      ...FAKE_META,
      chapterCount: 7,
      chapterSpineMap: [1, 2, 3, 4, 5, 6, 7],
    });
    const agent = await adminAgent();
    const res = await agent.get('/api/books');
    expect(res.status).toBe(200);
    expect(res.body[0].chapterCount).toBe(7);
    expect(res.body[0].chapterSpineMap).toBeUndefined();
  });
```

Inside the existing `describe('GET /api/books/:id', ...)` block (or create one if it doesn't exist), add:

```ts
  it('includes chapterCount and excludes chapterSpineMap', async () => {
    bookStore.addBook('bk1', 'book1.epub', path.join(booksDir, 'book1.epub'), 100, new Date(), {
      ...FAKE_META,
      chapterCount: 5,
      chapterSpineMap: [1, 2, 3, 4, 5],
    });
    const agent = await adminAgent();
    const res = await agent.get('/api/books/bk1');
    expect(res.status).toBe(200);
    expect(res.body.chapterCount).toBe(5);
    expect(res.body.chapterSpineMap).toBeUndefined();
  });
```

- [ ] **Step 2: Add failing tests for the progress API (`currentChapter`)**

Inside the existing `describe('GET /api/my/progress', ...)` block, add:

```ts
  it('includes currentChapter when a matching book has chapter data and CFI is valid', async () => {
    // spine: cover(0) ch1(1) ch2(2) ch3(3); nav: ch1→1, ch2→2, ch3→3
    bookStore.addBook('doc-with-chapters', 'chapters.epub', path.join(booksDir, 'chapters.epub'), 100, new Date(), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    // EPUB_CFI(/6/6...) → N=6 → spineIndex=(6-2)/2=2 → chapter 2 (ch2 is at spineIndex 2)
    userStore.saveProgress('alice', {
      document: 'doc-with-chapters',
      progress: 'EPUB_CFI(/6/6[ch2]!/4/1:0)',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.status).toBe(200);
    expect(res.body[0].currentChapter).toBe(2);
  });

  it('omits currentChapter when the book is not in the DB', async () => {
    userStore.saveProgress('alice', {
      document: 'unknown-book-id',
      progress: 'EPUB_CFI(/6/4!/4/1:0)',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.status).toBe(200);
    expect(res.body[0].currentChapter).toBeUndefined();
  });

  it('omits currentChapter when the CFI is not in KoReader EPUB_CFI format', async () => {
    bookStore.addBook('doc-bad-cfi', 'bad-cfi.epub', path.join(booksDir, 'bad-cfi.epub'), 100, new Date(), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    userStore.saveProgress('alice', {
      document: 'doc-bad-cfi',
      progress: '/p[1]',
      percentage: 0.1,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.status).toBe(200);
    expect(res.body[0].currentChapter).toBeUndefined();
  });

  it('does not expose chapterSpineMap on progress records', async () => {
    bookStore.addBook('doc-no-expose', 'no-expose.epub', path.join(booksDir, 'no-expose.epub'), 100, new Date(), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    userStore.saveProgress('alice', {
      document: 'doc-no-expose',
      progress: 'EPUB_CFI(/6/4!/4/1:0)',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await userAgent();
    const res = await agent.get('/api/my/progress');
    expect(res.body[0].chapterSpineMap).toBeUndefined();
  });
```

- [ ] **Step 3: Run the new tests to verify they fail**

```
npm test -- --testPathPattern=ui
```

Expected: the new book API tests fail because `chapterSpineMap` is currently exposed (not stripped), and the progress tests fail because `currentChapter` doesn't exist yet.

- [ ] **Step 4: Update `app/routes/ui.ts` — strip `chapterSpineMap` from book list response**

In the `GET /api/books` handler, add `chapterSpineMap: _chapterSpineMap` to the destructuring:

```ts
  router.get('/api/books', sessionAuth, (_req: Request, res: Response) => {
    res.json(
      bookStore.listBooks().map((b) => {
        const {
          path: _path,
          description: _description,
          publisher: _publisher,
          identifiers: _identifiers,
          subjects: _subjects,
          addedAt: _addedAt,
          chapterSpineMap: _chapterSpineMap,
          ...rest
        } = b;
        return rest;
      })
    );
  });
```

- [ ] **Step 5: Update `app/routes/ui.ts` — strip `chapterSpineMap` from single book response**

In the `GET /api/books/:id` handler, update the destructuring:

```ts
    const { path: _path, chapterSpineMap: _chapterSpineMap, ...rest } = book;
    res.json(rest);
```

- [ ] **Step 6: Update `app/routes/ui.ts` — add `currentChapter` to progress response**

Add the import at the top of `ui.ts`:

```ts
import { parseCfiSpineIndex, spineIndexToChapter } from '../utils/cfi';
```

Replace the `GET /api/my/progress` handler body with:

```ts
  router.get('/api/my/progress', sessionAuth, (req: Request, res: Response) => {
    if (req.session.isAdmin) {
      res.json([]);
      return;
    }
    const progressList = userStore.getUserProgress(req.session.username!);
    res.json(
      progressList.map((p) => {
        const spineIndex = parseCfiSpineIndex(p.progress);
        const book = bookStore.getBookById(p.document);
        const currentChapter =
          spineIndex !== null && book && book.chapterSpineMap.length > 0
            ? spineIndexToChapter(spineIndex, book.chapterSpineMap) ?? undefined
            : undefined;
        return {
          document: p.document,
          percentage: p.percentage,
          ...(currentChapter !== undefined ? { currentChapter } : {}),
        };
      })
    );
  });
```

- [ ] **Step 7: Run tests to verify they pass**

```
npm test -- --testPathPattern=ui
```

Expected: all tests pass, including the new book API and progress API tests.

- [ ] **Step 8: Run the full test suite**

```
npm test
```

Expected: all tests pass across all files.

- [ ] **Step 9: Commit**

```bash
git add app/routes/ui.ts app/routes/ui.test.ts
git commit -m "feat: expose chapterCount on book API and currentChapter on progress API"
```

---

## Task 6: Update client types

**Files:**
- Modify: `client/src/provider/book/type.ts`
- Modify: `client/src/provider/progress/type.ts`

- [ ] **Step 1: Add `chapterCount` to client `Book` type**

In `client/src/provider/book/type.ts`, add `chapterCount: number` to the `Book` interface:

```ts
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
};
```

- [ ] **Step 2: Add `currentChapter` to client `Progress` type**

In `client/src/provider/progress/type.ts`, add the optional field:

```ts
export type Progress = {
  document: string;
  percentage: number;
  device?: string;
  timestamp?: number;
  currentChapter?: number;
};
```

- [ ] **Step 3: Run the TypeScript compiler to verify no type errors**

```
npm run lint
```

Expected: no type errors. If `book.chapterCount` is referenced somewhere and flagged as unexpected, the type addition resolves it. If there are pre-existing errors unrelated to this change, note them but proceed.

- [ ] **Step 4: Commit**

```bash
git add client/src/provider/book/type.ts client/src/provider/progress/type.ts
git commit -m "feat: add chapterCount to client Book type and currentChapter to client Progress type"
```

---

## Task 7: Update the Book page

**Files:**
- Modify: `client/src/page/book/index.tsx`

- [ ] **Step 1: Add `chapters` to the metadata list**

In `client/src/page/book/index.tsx`, in the `metadata` IIFE (around line 37), add a `chapters` entry after the `format` entry:

```ts
  const metadata = (() => {
    const metadataList: Metadata[] = [];
    if (book === undefined) {
      return metadataList;
    }
    if (book.publisher) {
      metadataList.push({ title: 'publisher', value: book.publisher });
    }
    metadataList.push({ title: 'format', value: 'EPUB' });
    if (book.chapterCount > 0) {
      metadataList.push({ title: 'chapters', value: book.chapterCount.toString() });
    }
    metadataList.push({ title: 'size', value: formatSize(book.size) });
    if (book.addedAt) {
      metadataList.push({ title: 'added', value: new Date(book.addedAt).toLocaleDateString() });
    }
    return metadataList;
  })();
```

- [ ] **Step 2: Replace the dummy `ChapterProgress` with real values**

In the JSX (around line 114), replace:

```tsx
{progress && progress.percentage && <ChapterProgress current={5} total={20} />}
```

with:

```tsx
{progress && progress.percentage > 0 && book.chapterCount > 0 && progress.currentChapter != null && (
  <ChapterProgress current={progress.currentChapter} total={book.chapterCount} />
)}
```

- [ ] **Step 3: Run lint to check for type errors**

```
npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/page/book/index.tsx
git commit -m "feat: display real chapter count in book metadata and wire ChapterProgress with live values"
```

---

## Final verification

- [ ] **Run the full test suite one last time**

```
npm test
```

Expected: all tests pass.

# Chapter Parsing Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix unreliable chapter counts by making nav flattening leaf-only and adding a title deny list for front/back matter.

**Architecture:** Two changes to `parseNavChapters` in `epub-parser.ts`: (1) `flattenNavOl` and `flattenNcxNavPoints` gain a `leafOnly` parameter — when true (default), parent `<li>` / `navPoint` entries that have children are skipped; (2) a `isTitleDenied` function filters entries by a static deny list before spine index resolution. Both changes are layered beneath the existing `epub:type` filter.

**Tech Stack:** TypeScript, `fast-xml-parser`, `adm-zip`, Jest (`ts-jest`)

---

## Files

- Modify: `app/server/services/epub-parser.ts` — leaf-only flatten params, deny list, updated call sites
- Modify: `app/server/services/epub-parser.test.ts` — update one broken test, add eight new tests

---

## Task 1: Update broken existing test + add leaf-only tests (RED)

The existing "flattens nested nav entries" test currently expects the parent "Chapter 2" AND its child "Section 2a" both counted. After our change, the parent is skipped so only leaf nodes are returned. Update that expectation now (making it RED), then add new tests for the desired leaf-only behavior.

**Files:**
- Modify: `app/server/services/epub-parser.test.ts`

- [ ] **Step 1: Update the existing "flattens nested nav entries" test**

Open `app/server/services/epub-parser.test.ts`. Find the test at the block starting `it('flattens nested nav entries'` (around line 812). Change the two expectation lines at the bottom:

```typescript
      // spine: cover(0) ch1(1) ch2(2) sec2a(3) ch3(4)
      // leaf-only: ch2 skipped (has child), so ch1(1) sec2a(3) ch3(4) returned
      expect(meta.chapterCount).toBe(3);
      expect(meta.chapterSpineMap).toEqual([1, 3, 4]);
```

The `chapterNames` assertion is not present in the original test so nothing else needs changing there.

- [ ] **Step 2: Add new leaf-only nav test**

Add this test inside the `describe('chapter detection'` block, after the existing "flattens nested nav entries" test:

```typescript
    it('excludes parent nav entries that have children (leaf-only)', () => {
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
    <item id="part1" href="part1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="part1"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
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
        <li>
          <a href="part1.xhtml">Part I</a>
          <ol>
            <li><a href="ch1.xhtml">Chapter 1</a></li>
            <li><a href="ch2.xhtml">Chapter 2</a></li>
          </ol>
        </li>
      </ol>
    </nav>
  </body>
</html>`)
      );
      ['part1.xhtml', 'ch1.xhtml', 'ch2.xhtml'].forEach((f) =>
        zip.addFile(`OEBPS/${f}`, Buffer.from('<html/>'))
      );
      const filePath = path.join(tmpDir, 'leaf-only-nav.epub');
      fs.writeFileSync(filePath, zip.toBuffer());
      const meta = parseEpub(filePath);
      // part1 (spine 0) excluded; ch1 (1) and ch2 (2) returned
      expect(meta.chapterCount).toBe(2);
      expect(meta.chapterSpineMap).toEqual([1, 2]);
      expect(meta.chapterNames).toEqual(['Chapter 1', 'Chapter 2']);
    });
```

- [ ] **Step 3: Add new leaf-only NCX test**

Add immediately after the test from Step 2:

```typescript
    it('excludes parent navPoints that have children in NCX (leaf-only)', () => {
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
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="part1" href="part1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="part1"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`)
      );
      zip.addFile(
        'OEBPS/toc.ncx',
        Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="part1">
      <navLabel><text>Part I</text></navLabel>
      <content src="part1.xhtml"/>
      <navPoint id="ch1">
        <navLabel><text>Chapter 1</text></navLabel>
        <content src="ch1.xhtml"/>
      </navPoint>
      <navPoint id="ch2">
        <navLabel><text>Chapter 2</text></navLabel>
        <content src="ch2.xhtml"/>
      </navPoint>
    </navPoint>
  </navMap>
</ncx>`)
      );
      ['part1.xhtml', 'ch1.xhtml', 'ch2.xhtml'].forEach((f) =>
        zip.addFile(`OEBPS/${f}`, Buffer.from('<html/>'))
      );
      const filePath = path.join(tmpDir, 'leaf-only-ncx.epub');
      fs.writeFileSync(filePath, zip.toBuffer());
      const meta = parseEpub(filePath);
      expect(meta.chapterCount).toBe(2);
      expect(meta.chapterSpineMap).toEqual([1, 2]);
      expect(meta.chapterNames).toEqual(['Chapter 1', 'Chapter 2']);
    });
```

- [ ] **Step 4: Add all-parents fallback test**

Add immediately after the test from Step 3:

```typescript
    it('falls back to full flatten when leaf-only nav produces no spine matches', () => {
      // Every top-level entry has children but those children reference unknown files.
      // leaf-only finds leaves that don't resolve to spine items → 0 after hrefsToSpineMap.
      // full-flatten finds the parent entry which DOES resolve → fallback produces a result.
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
        <li>
          <a href="ch1.xhtml">Chapter 1</a>
          <ol>
            <li><a href="missing.xhtml">Section</a></li>
          </ol>
        </li>
      </ol>
    </nav>
  </body>
</html>`)
      );
      zip.addFile('OEBPS/ch1.xhtml', Buffer.from('<html/>'));
      const filePath = path.join(tmpDir, 'fallback-nav.epub');
      fs.writeFileSync(filePath, zip.toBuffer());
      const meta = parseEpub(filePath);
      // leaf 'missing.xhtml' not in spine → 0 from leaf-only → fallback includes ch1
      expect(meta.chapterCount).toBe(1);
      expect(meta.chapterSpineMap).toEqual([0]);
      expect(meta.chapterNames).toEqual(['Chapter 1']);
    });
```

- [ ] **Step 5: Run the tests to confirm RED**

```bash
cd /workspaces/HASS-ODPS && npm test -w app/server -- --testPathPattern=epub-parser 2>&1 | tail -30
```

Expected: failures on "flattens nested nav entries" (wrong count), "excludes parent nav entries", "excludes parent navPoints", "falls back to full flatten".

---

## Task 2: Implement leaf-only flattening (GREEN)

**Files:**
- Modify: `app/server/services/epub-parser.ts`

- [ ] **Step 1: Update `flattenNavOl` to support `leafOnly` mode**

Replace lines 31–46 of `app/server/services/epub-parser.ts`:

```typescript
function flattenNavOl(ol: unknown, leafOnly = true): { href: string; title: string }[] {
  if (!ol || typeof ol !== 'object') return [];
  const items = (ol as Record<string, unknown>).li;
  if (!items) return [];
  const result: { href: string; title: string }[] = [];
  for (const item of (Array.isArray(items) ? items : [items]) as Array<Record<string, unknown>>) {
    const aNode = item.a;
    const hasChildren = !!item.ol;
    if (!leafOnly || !hasChildren) {
      if (aNode && typeof aNode === 'object') {
        const href = (aNode as Record<string, string>)['@_href'];
        const title = ((aNode as Record<string, string>)['#text'] ?? '').trim();
        if (href) result.push({ href, title });
      }
    }
    if (item.ol) result.push(...flattenNavOl(item.ol, leafOnly));
  }
  return result;
}
```

- [ ] **Step 2: Update `flattenNcxNavPoints` to support `leafOnly` mode**

Replace lines 48–61 of `app/server/services/epub-parser.ts`:

```typescript
function flattenNcxNavPoints(navPoints: unknown[], leafOnly = true): { href: string; title: string }[] {
  const result: { href: string; title: string }[] = [];
  for (const np of navPoints as Array<Record<string, unknown>>) {
    const src = (np.content as Record<string, string> | undefined)?.['@_src'];
    const navLabel = np.navLabel as Record<string, unknown> | undefined;
    const title = ((navLabel?.text as string | undefined) ?? '').trim();
    const hasChildren = !!np.navPoint;
    if (!leafOnly || !hasChildren) {
      if (src) result.push({ href: src, title });
    }
    if (np.navPoint) {
      const nested = Array.isArray(np.navPoint) ? np.navPoint : [np.navPoint];
      result.push(...flattenNcxNavPoints(nested as unknown[], leafOnly));
    }
  }
  return result;
}
```

- [ ] **Step 3: Update the EPUB 3 nav call site in `parseNavChapters` to use leaf-only with fallback**

In `parseNavChapters`, replace the block starting with `if (tocNav) {` (around lines 164–174). The current body is:
```typescript
      if (tocNav) {
        const entries = flattenNavOl(tocNav.ol);
        const { spineMap, names } = hrefsToSpineMap(entries, navDir, spineHrefToIndex);
        const filtered = filterByEpubType(spineMap, names);
        if (filtered.spineMap.length > 0)
          return {
            chapterCount: filtered.spineMap.length,
            chapterSpineMap: filtered.spineMap,
            chapterNames: filtered.names,
          };
      }
```
Replace with:
```typescript
      if (tocNav) {
        let entries = flattenNavOl(tocNav.ol);
        let { spineMap, names } = hrefsToSpineMap(entries, navDir, spineHrefToIndex);
        if (spineMap.length === 0 && entries.length > 0) {
          entries = flattenNavOl(tocNav.ol, false);
          ({ spineMap, names } = hrefsToSpineMap(entries, navDir, spineHrefToIndex));
        }
        const filtered = filterByEpubType(spineMap, names);
        if (filtered.spineMap.length > 0)
          return {
            chapterCount: filtered.spineMap.length,
            chapterSpineMap: filtered.spineMap,
            chapterNames: filtered.names,
          };
      }
```

- [ ] **Step 4: Update the NCX call site in `parseNavChapters` to use leaf-only with fallback**

In `parseNavChapters`, replace the two lines (around line 191–192):
```typescript
      const entries = flattenNcxNavPoints(navPoints);
      const { spineMap, names } = hrefsToSpineMap(entries, ncxDir, spineHrefToIndex);
```
with:
```typescript
      let entries = flattenNcxNavPoints(navPoints);
      let { spineMap, names } = hrefsToSpineMap(entries, ncxDir, spineHrefToIndex);
      if (spineMap.length === 0 && entries.length > 0) {
        entries = flattenNcxNavPoints(navPoints, false);
        ({ spineMap, names } = hrefsToSpineMap(entries, ncxDir, spineHrefToIndex));
      }
```

- [ ] **Step 5: Run tests to confirm GREEN**

```bash
cd /workspaces/HASS-ODPS && npm test -w app/server -- --testPathPattern=epub-parser 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/server/services/epub-parser.ts app/server/services/epub-parser.test.ts
git commit -m "feat: skip parent nav entries with children (leaf-only chapter parsing)"
```

---

## Task 3: Add title deny list tests (RED)

**Files:**
- Modify: `app/server/services/epub-parser.test.ts`

- [ ] **Step 1: Add deny list tests inside `describe('chapter detection'`**

Add these tests after the fallback test added in Task 1:

```typescript
    it('filters out exact-match front matter titles from nav', () => {
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
    <item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>
    <item id="copyright" href="copyright.xhtml" media-type="application/xhtml+xml"/>
    <item id="dedication" href="dedication.xhtml" media-type="application/xhtml+xml"/>
    <item id="map" href="map.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="titlepage"/>
    <itemref idref="copyright"/>
    <itemref idref="dedication"/>
    <itemref idref="map"/>
    <itemref idref="ch1"/>
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
        <li><a href="cover.xhtml">Cover</a></li>
        <li><a href="titlepage.xhtml">Title Page</a></li>
        <li><a href="copyright.xhtml">Copyright</a></li>
        <li><a href="dedication.xhtml">Dedication</a></li>
        <li><a href="map.xhtml">Map</a></li>
        <li><a href="ch1.xhtml">Chapter 1</a></li>
      </ol>
    </nav>
  </body>
</html>`)
      );
      ['cover.xhtml', 'titlepage.xhtml', 'copyright.xhtml', 'dedication.xhtml', 'map.xhtml', 'ch1.xhtml'].forEach(
        (f) => zip.addFile(`OEBPS/${f}`, Buffer.from('<html/>'))
      );
      const filePath = path.join(tmpDir, 'deny-exact.epub');
      fs.writeFileSync(filePath, zip.toBuffer());
      const meta = parseEpub(filePath);
      expect(meta.chapterCount).toBe(1);
      expect(meta.chapterNames).toEqual(['Chapter 1']);
    });

    it('filters out prefix-match front matter titles from nav', () => {
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
    <item id="about" href="about.xhtml" media-type="application/xhtml+xml"/>
    <item id="bythesame" href="bythesame.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="about"/>
    <itemref idref="bythesame"/>
    <itemref idref="ch1"/>
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
        <li><a href="about.xhtml">About the Author</a></li>
        <li><a href="bythesame.xhtml">By the Same Author</a></li>
        <li><a href="ch1.xhtml">Chapter 1</a></li>
      </ol>
    </nav>
  </body>
</html>`)
      );
      ['about.xhtml', 'bythesame.xhtml', 'ch1.xhtml'].forEach((f) =>
        zip.addFile(`OEBPS/${f}`, Buffer.from('<html/>'))
      );
      const filePath = path.join(tmpDir, 'deny-prefix.epub');
      fs.writeFileSync(filePath, zip.toBuffer());
      const meta = parseEpub(filePath);
      expect(meta.chapterCount).toBe(1);
      expect(meta.chapterNames).toEqual(['Chapter 1']);
    });

    it('deny list matching is case-insensitive', () => {
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
    <item id="tp" href="tp.xhtml" media-type="application/xhtml+xml"/>
    <item id="cr" href="cr.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="tp"/>
    <itemref idref="cr"/>
    <itemref idref="ch1"/>
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
        <li><a href="cover.xhtml">COVER</a></li>
        <li><a href="tp.xhtml">Title Page</a></li>
        <li><a href="cr.xhtml">COPYRIGHT</a></li>
        <li><a href="ch1.xhtml">Chapter 1</a></li>
      </ol>
    </nav>
  </body>
</html>`)
      );
      ['cover.xhtml', 'tp.xhtml', 'cr.xhtml', 'ch1.xhtml'].forEach((f) =>
        zip.addFile(`OEBPS/${f}`, Buffer.from('<html/>'))
      );
      const filePath = path.join(tmpDir, 'deny-case.epub');
      fs.writeFileSync(filePath, zip.toBuffer());
      const meta = parseEpub(filePath);
      expect(meta.chapterCount).toBe(1);
      expect(meta.chapterNames).toEqual(['Chapter 1']);
    });

    it('deny list does not filter prologue, epilogue, or numbered chapters', () => {
      const filePath = path.join(tmpDir, 'deny-safe.epub');
      fs.writeFileSync(
        filePath,
        makeEpubWithNav([
          { title: 'Prologue', href: 'ch1.xhtml' },
          { title: 'Epilogue', href: 'ch2.xhtml' },
          { title: 'Chapter 1', href: 'ch3.xhtml' },
        ])
      );
      const meta = parseEpub(filePath);
      expect(meta.chapterCount).toBe(3);
      expect(meta.chapterNames).toEqual(['Prologue', 'Epilogue', 'Chapter 1']);
    });
```

    it('keeps flat chapter entries alongside filtered hierarchical entries', () => {
      // Mix: "Intro" is a flat leaf (kept), "Part I" has children (skipped), children are kept
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
    <item id="intro" href="intro.xhtml" media-type="application/xhtml+xml"/>
    <item id="part1" href="part1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="intro"/>
    <itemref idref="part1"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
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
        <li><a href="intro.xhtml">Introduction</a></li>
        <li>
          <a href="part1.xhtml">Part I</a>
          <ol>
            <li><a href="ch1.xhtml">Chapter 1</a></li>
            <li><a href="ch2.xhtml">Chapter 2</a></li>
          </ol>
        </li>
      </ol>
    </nav>
  </body>
</html>`)
      );
      ['intro.xhtml', 'part1.xhtml', 'ch1.xhtml', 'ch2.xhtml'].forEach((f) =>
        zip.addFile(`OEBPS/${f}`, Buffer.from('<html/>'))
      );
      const filePath = path.join(tmpDir, 'mixed-flat-hier.epub');
      fs.writeFileSync(filePath, zip.toBuffer());
      const meta = parseEpub(filePath);
      // intro (0) kept (flat leaf), part1 (1) excluded (has children), ch1 (2) and ch2 (3) kept
      expect(meta.chapterCount).toBe(3);
      expect(meta.chapterSpineMap).toEqual([0, 2, 3]);
      expect(meta.chapterNames).toEqual(['Introduction', 'Chapter 1', 'Chapter 2']);
    });

- [ ] **Step 2: Run tests to confirm RED**

```bash
cd /workspaces/HASS-ODPS && npm test -w app/server -- --testPathPattern=epub-parser 2>&1 | tail -20
```

Expected: four new failures ("filters out exact-match", "filters out prefix-match", "deny list matching is case-insensitive", "deny list does not filter") plus the new "mixed flat + hierarchical" test.

---

## Task 4: Implement title deny list (GREEN)

**Files:**
- Modify: `app/server/services/epub-parser.ts`

- [ ] **Step 1: Add the deny list constants and `isTitleDenied` function**

Add the following block in `app/server/services/epub-parser.ts` immediately after the closing brace of `flattenNcxNavPoints` (after line 61, before the `EXCLUDED_EPUB_TYPES` constant):

```typescript
const TITLE_DENY_EXACT = new Set([
  'cover',
  'title page',
  'titlepage',
  'copyright',
  'copyright page',
  'dedication',
  'contents',
  'table of contents',
  'toc',
  'acknowledgements',
  'acknowledgments',
  'epigraph',
  'map',
  'maps',
  'halftitle',
  'half title',
  'also by',
  'colophon',
  'dramatis personae',
  'cast of characters',
  'list of characters',
  'what has gone before',
]);

const TITLE_DENY_PREFIXES = ['about the', 'by the same', 'books by'];

function isTitleDenied(title: string): boolean {
  const lower = title.toLowerCase().trim();
  if (TITLE_DENY_EXACT.has(lower)) return true;
  return TITLE_DENY_PREFIXES.some((p) => lower.startsWith(p));
}
```

- [ ] **Step 2: Apply deny list at the EPUB 3 nav call site**

In `parseNavChapters`, find the `if (tocNav) {` block (updated in Task 2). Replace the entire body with:
```typescript
      if (tocNav) {
        let entries = flattenNavOl(tocNav.ol);
        const titleFiltered = entries.filter((e) => !isTitleDenied(e.title));
        let { spineMap, names } = hrefsToSpineMap(titleFiltered, navDir, spineHrefToIndex);
        if (spineMap.length === 0 && entries.length > 0) {
          const fbFiltered = flattenNavOl(tocNav.ol, false).filter((e) => !isTitleDenied(e.title));
          ({ spineMap, names } = hrefsToSpineMap(fbFiltered, navDir, spineHrefToIndex));
        }
        const filtered = filterByEpubType(spineMap, names);
        if (filtered.spineMap.length > 0)
          return {
            chapterCount: filtered.spineMap.length,
            chapterSpineMap: filtered.spineMap,
            chapterNames: filtered.names,
          };
      }
```

- [ ] **Step 3: Apply deny list at the NCX call site**

Find the block that currently reads (updated in Task 2):
```typescript
      let entries = flattenNcxNavPoints(navPoints);
      let { spineMap, names } = hrefsToSpineMap(entries, ncxDir, spineHrefToIndex);
      if (spineMap.length === 0 && entries.length > 0) {
        entries = flattenNcxNavPoints(navPoints, false);
        ({ spineMap, names } = hrefsToSpineMap(entries, ncxDir, spineHrefToIndex));
      }
```
Replace with:
```typescript
      let entries = flattenNcxNavPoints(navPoints);
      const titleFiltered = entries.filter((e) => !isTitleDenied(e.title));
      let { spineMap, names } = hrefsToSpineMap(titleFiltered, ncxDir, spineHrefToIndex);
      if (spineMap.length === 0 && entries.length > 0) {
        const fbFiltered = flattenNcxNavPoints(navPoints, false).filter((e) => !isTitleDenied(e.title));
        ({ spineMap, names } = hrefsToSpineMap(fbFiltered, ncxDir, spineHrefToIndex));
      }
```

- [ ] **Step 4: Run tests to confirm GREEN**

```bash
cd /workspaces/HASS-ODPS && npm test -w app/server -- --testPathPattern=epub-parser 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite and lint**

```bash
cd /workspaces/HASS-ODPS && npm run lint && npm test 2>&1 | tail -20
```

Expected: no lint errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/server/services/epub-parser.ts app/server/services/epub-parser.test.ts
git commit -m "feat: filter front/back matter by title deny list in chapter parsing"
```

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { zipSync, strToU8 } from 'fflate';

import { parseEpub } from './epub-parser';
import { assertValidEpub } from './epub-validator';
import { buildUpdatedEpub, repairPackageDocument } from './epub-writer';

// End-to-end guard: an edit of a genuinely valid EPUB must produce an EPUB that
// still passes epubcheck. Exercises the real @korzun/epubcheck-ts validator, so
// it catches structural regressions the lenient parseEpub round-trip misses —
// e.g. the mimetype entry losing its first/stored position (PKG-005/PKG-006) or
// a duplicated XML declaration in the OPF (RSC-005).

// Builds the same minimal valid EPUB-3 but with a caller-controlled set of
// dcterms:modified metas (0, 1, or many) to exercise the RSC-005 repair.
function epubWithModified(timestamps: string[]): Buffer {
  const modifiedMetas = timestamps
    .map((t) => `    <meta property="dcterms:modified">${t}</meta>`)
    .join('\n');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier>
    <dc:title>Baseline Title</dc:title>
    <dc:language>en</dc:language>
${modifiedMetas}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>TOC</title></head>
<body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Chapter 1</a></li></ol></nav></body></html>`;
  const c1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>C1</title></head><body><p>Hello.</p></body></html>`;
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  return Buffer.from(
    zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(container),
      'OEBPS/content.opf': strToU8(opf),
      'OEBPS/nav.xhtml': strToU8(nav),
      'OEBPS/c1.xhtml': strToU8(c1),
    })
  );
}

/** A minimal but epubcheck-valid EPUB 3 whose OPF carries an XML declaration. */
function minimalValidEpub(): Buffer {
  return epubWithModified(['2020-01-01T00:00:00Z']);
}

// A minimal EPUB *2* package (version="2.0", NCX toc) with a caller-controlled
// set of dcterms:modified metas. The RSC-005 "exactly once" count is an EPUB 3
// rule, so these packages must come back from the repair untouched.
function epub2WithModified(timestamps: string[]): Buffer {
  const modifiedMetas = timestamps
    .map((t) => `    <meta property="dcterms:modified">${t}</meta>`)
    .join('\n');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="pub-id" opf:scheme="uuid">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier>
    <dc:title>Baseline 2 Title</dc:title>
    <dc:language>en</dc:language>
${modifiedMetas}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/></spine>
</package>`;
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:12345678-1234-1234-1234-123456789abc"/></head>
  <docTitle><text>Baseline 2 Title</text></docTitle>
  <navMap><navPoint id="n1" playOrder="1"><navLabel><text>Chapter 1</text></navLabel><content src="c1.xhtml"/></navPoint></navMap>
</ncx>`;
  const c1 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>C1</title></head><body><p>Hello.</p></body></html>`;
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  return Buffer.from(
    zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(container),
      'OEBPS/content.opf': strToU8(opf),
      'OEBPS/toc.ncx': strToU8(ncx),
      'OEBPS/c1.xhtml': strToU8(c1),
    })
  );
}

describe('buildUpdatedEpub (real @korzun/epubcheck-ts)', () => {
  let dir: string;
  let src: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-writer-integ-'));
    src = path.join(dir, 'book.epub');
    fs.writeFileSync(src, minimalValidEpub());
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true });
  });

  it('the baseline fixture is itself valid', async () => {
    await expect(assertValidEpub(fs.readFileSync(src), 'ERROR')).resolves.toBeDefined();
  });

  it('a series edit leaves the EPUB valid', async () => {
    const edited = buildUpdatedEpub(src, { series: 'My Series', seriesIndex: 3 });
    await expect(assertValidEpub(edited, 'ERROR')).resolves.toBeDefined();
  }, 60000);

  it('a title edit leaves the EPUB valid', async () => {
    const edited = buildUpdatedEpub(src, { title: 'Edited Title' });
    await expect(assertValidEpub(edited, 'ERROR')).resolves.toBeDefined();
  }, 60000);

  // Regression: a title sort on an EPUB 2 package must NOT be written as an
  // `opf:file-as` attribute on <dc:title> — opf20.rng forbids it there, so
  // epubcheck raises RSC-005 ("attribute opf:file-as not allowed here"). The
  // sort belongs in <meta name="calibre:title_sort">. This is the ingest path
  // that silently corrupted leading-article titles (e.g. "The Dying Earth").
  it('an EPUB 2 titleSort edit stays valid and round-trips (no opf:file-as on dc:title)', async () => {
    const e2 = path.join(dir, 'book2.epub');
    fs.writeFileSync(e2, epub2WithModified([]));
    const edited = buildUpdatedEpub(e2, { titleSort: 'Baseline 2 Title, The' });
    await expect(assertValidEpub(edited, 'ERROR')).resolves.toBeDefined();
    fs.writeFileSync(e2, edited);
    expect(parseEpub(e2).titleSort).toBe('Baseline 2 Title, The');
  }, 60000);

  // Clearing the sort must remove the calibre:title_sort meta and stay valid.
  it('an EPUB 2 titleSort clear stays valid and round-trips to empty', async () => {
    const e2 = path.join(dir, 'book2clear.epub');
    fs.writeFileSync(e2, epub2WithModified([]));
    fs.writeFileSync(e2, buildUpdatedEpub(e2, { titleSort: 'Baseline 2 Title, The' }));
    const cleared = buildUpdatedEpub(e2, { titleSort: '' });
    await expect(assertValidEpub(cleared, 'ERROR')).resolves.toBeDefined();
    fs.writeFileSync(e2, cleared);
    expect(parseEpub(e2).titleSort).toBe('');
  }, 60000);
});

// A 1x1 PNG, so cover replacement points at real image bytes.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// Cross-version write sweep: every EpubChanges field, applied to both an EPUB 2
// (NCX toc) and an EPUB 3 (nav) package, must leave the EPUB epubcheck-valid.
// The write paths pick a version- and element-specific encoding; before this
// suite existed those choices were only exercised on EPUB 3, which is how the
// dc:title opf:file-as (RSC-005) and identifier/NCX dtb:uid (NCX-001) defects
// reached production. `identifiers` on the EPUB 2 fixture is the NCX-001 guard.
describe('buildUpdatedEpub cross-version write sweep (real @korzun/epubcheck-ts)', () => {
  const cases: Array<[string, Parameters<typeof buildUpdatedEpub>[1]]> = [
    ['title', { title: 'New Title' }],
    ['titleSort', { titleSort: 'New Title, A' }],
    ['author', { author: 'New Author' }],
    ['authorSort', { authorSort: 'Author, New' }],
    ['publishDate', { publishDate: '2021-05-04' }],
    ['description', { description: 'A new description.' }],
    ['publisher', { publisher: 'New Publisher' }],
    ['subjects', { subjects: ['Fiction', 'Adventure'] }],
    ['series', { series: 'My Series', seriesIndex: 2 }],
    ['identifiers', { identifiers: [{ scheme: 'ISBN', value: '9780316229296' }] }],
    ['cover', { coverData: TINY_PNG, coverMime: 'image/png' }],
  ];

  for (const [ver, make] of [
    ['EPUB 3', minimalValidEpub3Rich],
    ['EPUB 2', () => epub2WithModified([])],
  ] as const) {
    describe(ver, () => {
      let dir: string;
      beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-sweep-'));
      });
      afterEach(() => fs.rmSync(dir, { recursive: true }));

      for (const [name, changes] of cases) {
        it(`${name} leaves the EPUB valid`, async () => {
          const src = path.join(dir, 'b.epub');
          fs.writeFileSync(src, make());
          await expect(
            assertValidEpub(buildUpdatedEpub(src, changes), 'ERROR')
          ).resolves.toBeDefined();
        }, 60000);
      }
    });
  }
});

describe('repairPackageDocument (real @korzun/epubcheck-ts)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-repair-'));
  });

  it('dedupes a duplicate dcterms:modified so the EPUB validates', async () => {
    const src = path.join(dir, 'dup.epub');
    fs.writeFileSync(src, epubWithModified(['2020-01-01T00:00:00Z', '2022-01-01T00:00:00Z']));
    // RSC-005 pre-fix: epubcheck rejects a duplicate dcterms:modified.
    await expect(assertValidEpub(fs.readFileSync(src), 'ERROR')).rejects.toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          id: 'RSC-005',
          message: expect.stringContaining('dcterms:modified'),
        }),
      ]),
    });
    const repair = repairPackageDocument(src);
    expect(repair.repaired).toBe(true);
    expect(repair.action).toBe('deduped');
    await expect(assertValidEpub(repair.bytes, 'ERROR')).resolves.toBeDefined();
  });

  it('injects a dcterms:modified when missing so the EPUB validates', async () => {
    const src = path.join(dir, 'missing.epub');
    fs.writeFileSync(src, epubWithModified([]));
    // RSC-005 pre-fix: epubcheck rejects a missing dcterms:modified.
    await expect(assertValidEpub(fs.readFileSync(src), 'ERROR')).rejects.toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          id: 'RSC-005',
          message: expect.stringContaining('dcterms:modified'),
        }),
      ]),
    });
    const repair = repairPackageDocument(src);
    expect(repair.repaired).toBe(true);
    expect(repair.action).toBe('injected');
    await expect(assertValidEpub(repair.bytes, 'ERROR')).resolves.toBeDefined();
  });

  it('leaves an EPUB 2 without a dcterms:modified byte-identical (no rewrite)', async () => {
    // A Calibre-exported EPUB 2 (version="2.0") with no dcterms:modified once
    // failed upload with RSC-005, which is why the repair was extended to 2.x.
    // That rejection was an epubcheck-ts bug — the "exactly one dcterms:modified"
    // rule is EPUB 3-only, but the library applied it to EPUB 2 packages too
    // through 0.1.0-beta.2. Injecting is also wrong on its own terms: EPUBCheck
    // validates a 2.x package against opf20.rng, where `<meta>` takes `name` and
    // `content`, no other attributes, and no text — so a `property` meta would
    // make this valid file invalid. It must come back untouched.
    const src = path.join(dir, 'epub2-missing.epub');
    const original = epub2WithModified([]);
    fs.writeFileSync(src, original);
    await expect(assertValidEpub(original, 'ERROR')).resolves.toBeDefined();
    const repair = repairPackageDocument(src);
    expect(repair.repaired).toBe(false);
    expect(repair.action).toBe('none');
    expect(Buffer.compare(repair.bytes, original)).toBe(0);
  }, 60000);

  it('leaves a valid single-modified EPUB byte-identical (no rewrite)', () => {
    const src = path.join(dir, 'clean.epub');
    const original = epubWithModified(['2020-01-01T00:00:00Z']);
    fs.writeFileSync(src, original);
    const repair = repairPackageDocument(src);
    expect(repair.repaired).toBe(false);
    expect(repair.action).toBe('none');
    expect(Buffer.compare(repair.bytes, original)).toBe(0);
  });
});

// A minimal but epubcheck-valid EPUB 3 whose OPF carries a titled creator and a
// unique-identifier-referenced identifier — the shape needed to exercise
// version-aware refinement writing (file-as / identifier-type). EPUB 3 forbids
// the EPUB 2 opf:file-as / opf:scheme attributes on Dublin Core elements
// (RSC-005 under epubcheck's schema layer); the writer must instead emit
// <meta refines> elements.
function minimalValidEpub3Rich(): Buffer {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier>
    <dc:title id="t1">Baseline Title</dc:title>
    <dc:creator id="c1">Original Author</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1doc" href="c1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1doc"/></spine>
</package>`;
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>TOC</title></head>
<body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Chapter 1</a></li></ol></nav></body></html>`;
  const c1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>C1</title></head><body><p>Hello.</p></body></html>`;
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  return Buffer.from(
    zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(container),
      'OEBPS/content.opf': strToU8(opf),
      'OEBPS/nav.xhtml': strToU8(nav),
      'OEBPS/c1.xhtml': strToU8(c1),
    })
  );
}

// Regression guard for the epubcheck-ts beta.4 upgrade, which added a schema
// (RelaxNG) layer that rejects EPUB 2-style refinement attributes on Dublin
// Core elements in an EPUB 3 package. buildUpdatedEpub must write refinements
// as <meta refines> elements for EPUB 3, and the result must both validate and
// round-trip through parseEpub.
describe('buildUpdatedEpub EPUB 3 refinements (real @korzun/epubcheck-ts)', () => {
  let dir: string;
  let src: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-writer-v3-'));
    src = path.join(dir, 'book.epub');
    fs.writeFileSync(src, minimalValidEpub3Rich());
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true });
  });

  it('the rich fixture is itself valid', async () => {
    await expect(assertValidEpub(fs.readFileSync(src), 'ERROR')).resolves.toBeDefined();
  });

  it('a titleSort edit stays valid and round-trips', async () => {
    const edited = buildUpdatedEpub(src, { titleSort: 'Baseline Title, The' });
    await expect(assertValidEpub(edited, 'ERROR')).resolves.toBeDefined();
    fs.writeFileSync(src, edited);
    expect(parseEpub(src).titleSort).toBe('Baseline Title, The');
  }, 60000);

  it('an authorSort edit stays valid and round-trips', async () => {
    const edited = buildUpdatedEpub(src, { authorSort: 'Author, Original' });
    await expect(assertValidEpub(edited, 'ERROR')).resolves.toBeDefined();
    fs.writeFileSync(src, edited);
    expect(parseEpub(src).authorSort).toBe('Author, Original');
  }, 60000);

  it('an identifier edit with a scheme stays valid, round-trips, and keeps the unique-identifier', async () => {
    const edited = buildUpdatedEpub(src, {
      identifiers: [{ scheme: 'ISBN', value: '9780316229296' }],
    });
    // Must not raise OPF-030 (unique-identifier reference lost) or RSC-005
    // (opf:scheme attribute rejected on an EPUB 3 dc:identifier).
    await expect(assertValidEpub(edited, 'ERROR')).resolves.toBeDefined();
    fs.writeFileSync(src, edited);
    expect(parseEpub(src).identifiers).toEqual([{ scheme: 'ISBN', value: '9780316229296' }]);
  }, 60000);

  it('clearing a titleSort removes the file-as refinement and stays valid', async () => {
    const withSort = buildUpdatedEpub(src, { titleSort: 'Baseline Title, The' });
    fs.writeFileSync(src, withSort);
    const cleared = buildUpdatedEpub(src, { titleSort: '' });
    await expect(assertValidEpub(cleared, 'ERROR')).resolves.toBeDefined();
    fs.writeFileSync(src, cleared);
    expect(parseEpub(src).titleSort).toBe('');
  }, 60000);
});

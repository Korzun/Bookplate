import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { zipSync, strToU8 } from 'fflate';

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

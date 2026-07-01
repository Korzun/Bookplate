import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import AdmZip from 'adm-zip';
import { buildUpdatedEpub } from './epub-writer';
import { parseEpub } from './epub-parser';

function makeEpub(
  opts: {
    title?: string;
    author?: string;
    titleSort?: string;
    authorSort?: string;
    publishDate?: string;
    description?: string;
    publisher?: string;
    series?: string;
    seriesIndex?: number;
    identifiers?: { scheme?: string; value: string }[];
    subjects?: string[];
    coverData?: Buffer;
    coverMime?: string;
  } = {}
): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)
  );

  const titleSortAttr = opts.titleSort ? ` file-as="${opts.titleSort}"` : '';
  const authorSortAttr = opts.authorSort ? ` file-as="${opts.authorSort}"` : '';
  const dateElem = opts.publishDate ? `<dc:date>${opts.publishDate}</dc:date>` : '';
  const coverItem = opts.coverData
    ? `<item id="cover-img" href="cover.jpg" media-type="${opts.coverMime ?? 'image/jpeg'}"/>`
    : '';
  const coverMeta = opts.coverData ? `<meta name="cover" content="cover-img"/>` : '';
  const seriesMeta = opts.series
    ? `<meta name="calibre:series" content="${opts.series}"/><meta name="calibre:series_index" content="${opts.seriesIndex ?? 1}"/>`
    : '';
  const identifierElems = (opts.identifiers ?? [])
    .map((id) =>
      id.scheme
        ? `<dc:identifier opf:scheme="${id.scheme}">${id.value}</dc:identifier>`
        : `<dc:identifier>${id.value}</dc:identifier>`
    )
    .join('\n    ');
  const subjectElems = (opts.subjects ?? [])
    .map((s) => `<dc:subject>${s}</dc:subject>`)
    .join('\n    ');

  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" xmlns:opf="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${opts.title !== undefined ? `<dc:title${titleSortAttr}>${opts.title}</dc:title>` : ''}
    ${opts.author !== undefined ? `<dc:creator${authorSortAttr}>${opts.author}</dc:creator>` : ''}
    ${dateElem}
    ${opts.description !== undefined ? `<dc:description>${opts.description}</dc:description>` : ''}
    ${opts.publisher !== undefined ? `<dc:publisher>${opts.publisher}</dc:publisher>` : ''}
    ${identifierElems}
    ${subjectElems}
    ${coverMeta}
    ${seriesMeta}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${coverItem}
  </manifest>
  <spine toc="ncx"/>
</package>`)
  );
  if (opts.coverData) zip.addFile('OEBPS/cover.jpg', opts.coverData);
  return zip.toBuffer();
}

// ---------------------------------------------------------------------------
// Helpers for building ZIPs with data descriptor entries (bit 3)
// ---------------------------------------------------------------------------

/** CRC-32 as specified by the ZIP format (polynomial 0xEDB88320, reflected). */
const CRC32_TABLE = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC32_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a ZIP buffer where every entry uses a data descriptor (general-purpose
 * bit 3 set). The local file header stores 0 for CRC/sizes; the real values
 * live in a trailing data descriptor record. This is what many commercial EPUB
 * authoring tools produce.
 */
function zipWithDataDescriptors(entries: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let bodyOffset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const checksum = crc32(data);

    // Local file header — CRC and sizes are 0 (placeholders); the data
    // descriptor written after the compressed data holds the real values.
    const lh = Buffer.alloc(30 + nameBytes.length);
    lh.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0008, 6); // flags: bit 3 = data descriptor
    lh.writeUInt16LE(8, 8); // compression: deflate
    lh.writeUInt16LE(0, 10); // mod time
    lh.writeUInt16LE(0, 12); // mod date
    lh.writeUInt32LE(0, 14); // CRC-32 placeholder
    lh.writeUInt32LE(0, 18); // compressed size placeholder
    lh.writeUInt32LE(0, 22); // uncompressed size placeholder
    lh.writeUInt16LE(nameBytes.length, 26);
    lh.writeUInt16LE(0, 28); // no extra field
    nameBytes.copy(lh, 30);

    // Data descriptor (PK\x07\x08 signature followed by real CRC/sizes).
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0);
    dd.writeUInt32LE(checksum, 4);
    dd.writeUInt32LE(compressed.length, 8);
    dd.writeUInt32LE(data.length, 12);

    // Central directory entry — always carries the authoritative CRC/sizes.
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0008, 8); // flags: bit 3
    cd.writeUInt16LE(8, 10); // compression: deflate
    cd.writeUInt16LE(0, 12); // mod time
    cd.writeUInt16LE(0, 14); // mod date
    cd.writeUInt32LE(checksum, 16); // real CRC-32
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30); // extra length
    cd.writeUInt16LE(0, 32); // comment length
    cd.writeUInt16LE(0, 34); // disk start
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(bodyOffset, 42); // offset of local header
    nameBytes.copy(cd, 46);

    parts.push(lh, compressed, dd);
    bodyOffset += lh.length + compressed.length + dd.length;
    cdParts.push(cd);
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(entries.length, 8); // entries on disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(cdBuf.length, 12); // CD size
  eocd.writeUInt32LE(bodyOffset, 16); // CD offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...parts, cdBuf, eocd]);
}

// ---------------------------------------------------------------------------

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-writer-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

function toFile(buf: Buffer, name = 'test.epub'): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, buf);
  return p;
}

it('buildUpdatedEpub returns a Buffer with the applied changes, without writing to disk', () => {
  const src = path.join(os.tmpdir(), `epub-build-${Date.now()}.epub`);
  fs.writeFileSync(src, makeEpub({ title: 'Before', author: 'A' }));
  const before = fs.readFileSync(src);

  const out = buildUpdatedEpub(src, { title: 'After' });

  expect(Buffer.isBuffer(out)).toBe(true);
  expect(fs.readFileSync(src).equals(before)).toBe(true); // src untouched

  const roundTrip = path.join(os.tmpdir(), `epub-build-out-${Date.now()}.epub`);
  fs.writeFileSync(roundTrip, out);
  expect(parseEpub(roundTrip).title).toBe('After');
});

describe('buildUpdatedEpub', () => {
  it('updates title', () => {
    const f = toFile(makeEpub({ title: 'Old Title' }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { title: 'New Title' }));
    expect(parseEpub(f).title).toBe('New Title');
  });

  it('updates author', () => {
    const f = toFile(makeEpub({ author: 'Old Author' }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { author: 'New Author' }));
    expect(parseEpub(f).author).toBe('New Author');
  });

  it('updates authorSort independently of author', () => {
    const f = toFile(makeEpub({ author: 'John Doe', authorSort: 'Doe, John' }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { authorSort: 'Doe, J.' }));
    expect(parseEpub(f).authorSort).toBe('Doe, J.');
    expect(parseEpub(f).author).toBe('John Doe');
  });

  it('updates author without affecting authorSort', () => {
    const f = toFile(makeEpub({ author: 'John Doe', authorSort: 'Doe, John' }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { author: 'Jane Doe' }));
    expect(parseEpub(f).author).toBe('Jane Doe');
    expect(parseEpub(f).authorSort).toBe('Doe, John');
  });

  it('updates titleSort independently of title', () => {
    const f = toFile(makeEpub({ title: 'The Foundation', titleSort: 'Foundation, The' }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { titleSort: 'Foundation' }));
    expect(parseEpub(f).titleSort).toBe('Foundation');
    expect(parseEpub(f).title).toBe('The Foundation');
  });

  it('updates title without affecting titleSort', () => {
    const f = toFile(makeEpub({ title: 'Old Title', titleSort: 'Title, Old' }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { title: 'New Title' }));
    expect(parseEpub(f).title).toBe('New Title');
    expect(parseEpub(f).titleSort).toBe('Title, Old');
  });

  it('adds publishDate to an epub with no dc:date', () => {
    const f = toFile(makeEpub({ title: 'No Date' }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { publishDate: '2001-01-16' }));
    expect(parseEpub(f).publishDate).toBe('2001-01-16');
  });

  it('updates an existing publishDate', () => {
    const f = toFile(makeEpub({ title: 'Dated', publishDate: '2000-01-01' }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { publishDate: '2001-01-16' }));
    expect(parseEpub(f).publishDate).toBe('2001-01-16');
  });

  it('removes publishDate when empty string is given', () => {
    const f = toFile(makeEpub({ title: 'Dated', publishDate: '2000-01-01' }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { publishDate: '' }));
    expect(parseEpub(f).publishDate).toBe('');
  });

  it('updates description', () => {
    const f = toFile(makeEpub({ description: 'Old' }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { description: 'New desc' }));
    expect(parseEpub(f).description).toBe('New desc');
  });

  it('updates publisher', () => {
    const f = toFile(makeEpub({ publisher: 'Old Pub' }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { publisher: 'New Pub' }));
    expect(parseEpub(f).publisher).toBe('New Pub');
  });

  it('updates series name and index', () => {
    const f = toFile(makeEpub({ series: 'Old Series', seriesIndex: 1 }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { series: 'New Series', seriesIndex: 3 }));
    const meta = parseEpub(f);
    expect(meta.series).toBe('New Series');
    expect(meta.seriesIndex).toBe(3);
  });

  it('clears series when empty string is given', () => {
    const f = toFile(makeEpub({ series: 'Some Series', seriesIndex: 1 }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { series: '' }));
    expect(parseEpub(f).series).toBe('');
  });

  it('updates subjects', () => {
    const f = toFile(makeEpub({ subjects: ['Fiction'] }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { subjects: ['Science', 'History'] }));
    expect(parseEpub(f).subjects).toEqual(['Science', 'History']);
  });

  it('clears subjects when empty array given', () => {
    const f = toFile(makeEpub({ subjects: ['Fiction'] }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { subjects: [] }));
    expect(parseEpub(f).subjects).toEqual([]);
  });

  it('updates identifiers', () => {
    const f = toFile(makeEpub({ identifiers: [{ scheme: 'ISBN', value: '978-old' }] }));
    fs.writeFileSync(
      f,
      buildUpdatedEpub(f, { identifiers: [{ scheme: 'ISBN', value: '978-new' }] })
    );
    expect(parseEpub(f).identifiers).toEqual([{ scheme: 'ISBN', value: '978-new' }]);
  });

  it('adds cover to an epub with no cover', () => {
    const f = toFile(makeEpub({ title: 'No Cover' }));
    const coverBytes = Buffer.from('fake-png');
    fs.writeFileSync(f, buildUpdatedEpub(f, { coverData: coverBytes, coverMime: 'image/png' }));
    const meta = parseEpub(f);
    expect(meta.coverData).toEqual(coverBytes);
    expect(meta.coverMime).toBe('image/png');
  });

  it('replaces an existing cover', () => {
    const f = toFile(makeEpub({ coverData: Buffer.from('old-cover'), coverMime: 'image/jpeg' }));
    const newCover = Buffer.from('new-cover');
    fs.writeFileSync(f, buildUpdatedEpub(f, { coverData: newCover, coverMime: 'image/jpeg' }));
    expect(parseEpub(f).coverData).toEqual(newCover);
  });

  it('handles compound MIME types like image/svg+xml without creating bad extension', () => {
    const f = toFile(makeEpub({ title: 'SVG Book' }));
    const svgBytes = Buffer.from('<svg/>');
    fs.writeFileSync(f, buildUpdatedEpub(f, { coverData: svgBytes, coverMime: 'image/svg+xml' }));
    const meta = parseEpub(f);
    expect(meta.coverData).toEqual(svgBytes);
    expect(meta.coverMime).toBe('image/svg+xml');
  });

  it('does not modify unspecified fields', () => {
    const f = toFile(makeEpub({ title: 'Keep', author: 'Keep Author', publisher: 'Keep Pub' }));
    fs.writeFileSync(f, buildUpdatedEpub(f, { description: 'Only this changed' }));
    const meta = parseEpub(f);
    expect(meta.title).toBe('Keep');
    expect(meta.author).toBe('Keep Author');
    expect(meta.publisher).toBe('Keep Pub');
  });

  it('throws for a non-existent file', () => {
    expect(() => buildUpdatedEpub('/nonexistent/path.epub', { title: 'x' })).toThrow();
  });

  it('throws for a non-EPUB file (no container.xml)', () => {
    const f = toFile(Buffer.from('not a zip'), 'bad.epub');
    expect(() => buildUpdatedEpub(f, { title: 'x' })).toThrow();
  });

  describe('EPUBs whose ZIP entries use data descriptors (bit 3 set)', () => {
    // Many commercial EPUB tools set the ZIP general-purpose bit 3 (data
    // descriptor flag) on every entry, storing CRC/sizes in a trailing
    // descriptor rather than the local file header. adm-zip previously
    // preserved this flag on rewrite but omitted the descriptors, making
    // the resulting archive unreadable.
    it('writes series info and remains fully readable after the round-trip', () => {
      // Extract entries from a normal synthetic EPUB and rebuild the ZIP so
      // that every entry uses a data descriptor, reproducing the commercial
      // tool layout without depending on any external fixture file.
      const srcZip = new AdmZip(makeEpub({ title: 'Descriptor Test' }));
      const entries = srcZip
        .getEntries()
        .map((e) => ({ name: e.entryName, data: e.isDirectory ? Buffer.alloc(0) : e.getData() }));
      const f = toFile(zipWithDataDescriptors(entries), 'descriptor-test.epub');

      expect(parseEpub(f).series).toBe('');

      fs.writeFileSync(f, buildUpdatedEpub(f, { series: 'Test Series', seriesIndex: 2 }));

      const after = parseEpub(f);
      expect(after.series).toBe('Test Series');
      expect(after.seriesIndex).toBe(2);
      expect(after.title).toBe('Descriptor Test');
    });
  });
});

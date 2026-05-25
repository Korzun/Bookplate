import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { writeMetadata } from './epub-writer';
import { parseEpub } from './epub-parser';

function makeEpub(
  opts: {
    title?: string;
    author?: string;
    fileAs?: string;
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

  const fileAsAttr = opts.fileAs ? ` file-as="${opts.fileAs}"` : '';
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
    ${opts.title !== undefined ? `<dc:title>${opts.title}</dc:title>` : ''}
    ${opts.author !== undefined ? `<dc:creator${fileAsAttr}>${opts.author}</dc:creator>` : ''}
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

describe('writeMetadata', () => {
  it('updates title', () => {
    const f = toFile(makeEpub({ title: 'Old Title' }));
    writeMetadata(f, { title: 'New Title' });
    expect(parseEpub(f).title).toBe('New Title');
  });

  it('updates author', () => {
    const f = toFile(makeEpub({ author: 'Old Author' }));
    writeMetadata(f, { author: 'New Author' });
    expect(parseEpub(f).author).toBe('New Author');
  });

  it('updates fileAs', () => {
    const f = toFile(makeEpub({ author: 'John Doe', fileAs: 'Doe, John' }));
    writeMetadata(f, { fileAs: 'Doe, J.' });
    expect(parseEpub(f).fileAs).toBe('Doe, J.');
  });

  it('updates description', () => {
    const f = toFile(makeEpub({ description: 'Old' }));
    writeMetadata(f, { description: 'New desc' });
    expect(parseEpub(f).description).toBe('New desc');
  });

  it('updates publisher', () => {
    const f = toFile(makeEpub({ publisher: 'Old Pub' }));
    writeMetadata(f, { publisher: 'New Pub' });
    expect(parseEpub(f).publisher).toBe('New Pub');
  });

  it('updates series name and index', () => {
    const f = toFile(makeEpub({ series: 'Old Series', seriesIndex: 1 }));
    writeMetadata(f, { series: 'New Series', seriesIndex: 3 });
    const meta = parseEpub(f);
    expect(meta.series).toBe('New Series');
    expect(meta.seriesIndex).toBe(3);
  });

  it('clears series when empty string is given', () => {
    const f = toFile(makeEpub({ series: 'Some Series', seriesIndex: 1 }));
    writeMetadata(f, { series: '' });
    expect(parseEpub(f).series).toBe('');
  });

  it('updates subjects', () => {
    const f = toFile(makeEpub({ subjects: ['Fiction'] }));
    writeMetadata(f, { subjects: ['Science', 'History'] });
    expect(parseEpub(f).subjects).toEqual(['Science', 'History']);
  });

  it('clears subjects when empty array given', () => {
    const f = toFile(makeEpub({ subjects: ['Fiction'] }));
    writeMetadata(f, { subjects: [] });
    expect(parseEpub(f).subjects).toEqual([]);
  });

  it('updates identifiers', () => {
    const f = toFile(makeEpub({ identifiers: [{ scheme: 'ISBN', value: '978-old' }] }));
    writeMetadata(f, { identifiers: [{ scheme: 'ISBN', value: '978-new' }] });
    expect(parseEpub(f).identifiers).toEqual([{ scheme: 'ISBN', value: '978-new' }]);
  });

  it('adds cover to an epub with no cover', () => {
    const f = toFile(makeEpub({ title: 'No Cover' }));
    const coverBytes = Buffer.from('fake-png');
    writeMetadata(f, { coverData: coverBytes, coverMime: 'image/png' });
    const meta = parseEpub(f);
    expect(meta.coverData).toEqual(coverBytes);
    expect(meta.coverMime).toBe('image/png');
  });

  it('replaces an existing cover', () => {
    const f = toFile(makeEpub({ coverData: Buffer.from('old-cover'), coverMime: 'image/jpeg' }));
    const newCover = Buffer.from('new-cover');
    writeMetadata(f, { coverData: newCover, coverMime: 'image/jpeg' });
    expect(parseEpub(f).coverData).toEqual(newCover);
  });

  it('handles compound MIME types like image/svg+xml without creating bad extension', () => {
    const f = toFile(makeEpub({ title: 'SVG Book' }));
    const svgBytes = Buffer.from('<svg/>');
    writeMetadata(f, { coverData: svgBytes, coverMime: 'image/svg+xml' });
    const meta = parseEpub(f);
    expect(meta.coverData).toEqual(svgBytes);
    expect(meta.coverMime).toBe('image/svg+xml');
  });

  it('does not modify unspecified fields', () => {
    const f = toFile(makeEpub({ title: 'Keep', author: 'Keep Author', publisher: 'Keep Pub' }));
    writeMetadata(f, { description: 'Only this changed' });
    const meta = parseEpub(f);
    expect(meta.title).toBe('Keep');
    expect(meta.author).toBe('Keep Author');
    expect(meta.publisher).toBe('Keep Pub');
  });

  it('throws for a non-existent file', () => {
    expect(() => writeMetadata('/nonexistent/path.epub', { title: 'x' })).toThrow();
  });

  it('throws for a non-EPUB file (no container.xml)', () => {
    const f = toFile(Buffer.from('not a zip'), 'bad.epub');
    expect(() => writeMetadata(f, { title: 'x' })).toThrow();
  });
});

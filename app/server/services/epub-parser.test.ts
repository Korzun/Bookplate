import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import AdmZip from 'adm-zip';

import { partialMD5, parseEpub } from './epub-parser';

// Helper: build a minimal EPUB zip as a Buffer
function makeEpub(
  opts: {
    title?: string;
    author?: string;
    description?: string;
    publisher?: string;
    identifiers?: Array<{ scheme?: string; value: string }>;
    subjects?: string[];
    series?: string;
    seriesIndex?: number;
    coverData?: Buffer;
    coverMime?: string;
  } = {}
): Buffer {
  const zip = new AdmZip();

  const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  zip.addFile('META-INF/container.xml', Buffer.from(containerXml));

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

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" xmlns:opf="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${opts.title !== undefined ? `<dc:title>${opts.title}</dc:title>` : ''}
    ${opts.author !== undefined ? `<dc:creator>${opts.author}</dc:creator>` : ''}
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
</package>`;
  zip.addFile('OEBPS/content.opf', Buffer.from(opf));

  if (opts.coverData) {
    zip.addFile('OEBPS/cover.jpg', opts.coverData);
  }

  return zip.toBuffer();
}

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
    ...chapters.map(
      (c, i) => `<item id="ch${i}" href="${c.href}" media-type="application/xhtml+xml"/>`
    ),
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

  const navItems = chapters
    .map((c) => `<li><a href="${c.href}">${c.title}</a></li>`)
    .join('\n        ');
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
    zip.addFile(
      `OEBPS/${chapter.href}`,
      Buffer.from(`<html><body><p>${chapter.title}</p></body></html>`)
    );
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
    ...chapters.map(
      (c, i) => `<item id="ch${i}" href="${c.href}" media-type="application/xhtml+xml"/>`
    ),
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
    zip.addFile(
      `OEBPS/${chapter.href}`,
      Buffer.from(`<html><body><p>${chapter.title}</p></body></html>`)
    );
  }
  zip.addFile('OEBPS/cover.xhtml', Buffer.from('<html><body>Cover</body></html>'));

  return zip.toBuffer();
}

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

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

describe('partialMD5', () => {
  it('returns a 32-char hex string', () => {
    const filePath = path.join(tmpDir, 'test.epub');
    fs.writeFileSync(filePath, makeEpub({ title: 'Test' }));
    const result = partialMD5(filePath);
    expect(result).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic for same file content', () => {
    const buf = makeEpub({ title: 'Same' });
    const f1 = path.join(tmpDir, 'a.epub');
    const f2 = path.join(tmpDir, 'b.epub');
    fs.writeFileSync(f1, buf);
    fs.writeFileSync(f2, buf);
    expect(partialMD5(f1)).toBe(partialMD5(f2));
  });

  it('differs for different file content', () => {
    const f1 = path.join(tmpDir, 'a.epub');
    const f2 = path.join(tmpDir, 'b.epub');
    fs.writeFileSync(f1, makeEpub({ title: 'Book A' }));
    fs.writeFileSync(f2, makeEpub({ title: 'Book B' }));
    expect(partialMD5(f1)).not.toBe(partialMD5(f2));
  });

  it('works on tiny files (< 1024 bytes)', () => {
    const filePath = path.join(tmpDir, 'tiny.epub');
    fs.writeFileSync(filePath, Buffer.from('tiny'));
    // Should not throw, should return 32-char hex
    expect(partialMD5(filePath)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('parseEpub', () => {
  const sharedContainerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  it('parses title and author', () => {
    const filePath = path.join(tmpDir, 'book.epub');
    fs.writeFileSync(filePath, makeEpub({ title: 'My Title', author: 'Jane Doe' }));
    const meta = parseEpub(filePath);
    expect(meta.title).toBe('My Title');
    expect(meta.author).toBe('Jane Doe');
  });

  it('parses description', () => {
    const filePath = path.join(tmpDir, 'book.epub');
    fs.writeFileSync(filePath, makeEpub({ title: 'T', description: 'A great book.' }));
    const meta = parseEpub(filePath);
    expect(meta.description).toBe('A great book.');
  });

  it('parses calibre series and series index', () => {
    const filePath = path.join(tmpDir, 'book.epub');
    fs.writeFileSync(filePath, makeEpub({ title: 'T', series: 'Discworld', seriesIndex: 3 }));
    const meta = parseEpub(filePath);
    expect(meta.series).toBe('Discworld');
    expect(meta.seriesIndex).toBe(3);
  });

  it('returns empty defaults when fields absent', () => {
    const filePath = path.join(tmpDir, 'bare.epub');
    fs.writeFileSync(filePath, makeEpub({ title: 'Bare' }));
    const meta = parseEpub(filePath);
    expect(meta.author).toBe('');
    expect(meta.description).toBe('');
    expect(meta.series).toBe('');
    expect(meta.seriesIndex).toBe(0);
    expect(meta.coverData).toBeNull();
    expect(meta.coverMime).toBeNull();
    expect(meta.titleSort).toBe('');
    expect(meta.authorSort).toBe('');
    expect(meta.publishDate).toBe('');
  });

  it('falls back to filename stem when title absent', () => {
    const filePath = path.join(tmpDir, 'my-book.epub');
    fs.writeFileSync(filePath, makeEpub({}));
    const meta = parseEpub(filePath);
    expect(meta.title).toBe('my-book');
  });

  it('parses title-level file-as from an attributed dc:title', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title id="t1" file-as="Asimov, Isaac">I, Robot</dc:title>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'irobot.epub');
    fs.writeFileSync(filePath, zip.toBuffer());

    const meta = parseEpub(filePath);

    expect(meta.title).toBe('I, Robot');
    expect(meta.titleSort).toBe('Asimov, Isaac');
    expect(meta.authorSort).toBe('');
  });

  it('returns empty titleSort when the chosen title has no file-as attribute', () => {
    const filePath = path.join(tmpDir, 'plain-title.epub');
    fs.writeFileSync(filePath, makeEpub({ title: 'Plain Title' }));

    const meta = parseEpub(filePath);

    expect(meta.title).toBe('Plain Title');
    expect(meta.titleSort).toBe('');
    expect(meta.authorSort).toBe('');
  });

  it('parses file-as from an opf namespace attribute', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title id="t1" opf:file-as="Asimov, Isaac">I, Robot</dc:title>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'irobot-opf.epub');
    fs.writeFileSync(filePath, zip.toBuffer());

    const meta = parseEpub(filePath);

    expect(meta.title).toBe('I, Robot');
    expect(meta.titleSort).toBe('Asimov, Isaac');
    expect(meta.authorSort).toBe('');
  });

  it('parses file-as from an EPUB 3 <meta refines> element', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title id="t1">Foundation</dc:title>
    <meta refines="#t1" property="file-as">Asimov, Isaac</meta>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'foundation-refines.epub');
    fs.writeFileSync(filePath, zip.toBuffer());

    const meta = parseEpub(filePath);

    expect(meta.title).toBe('Foundation');
    expect(meta.titleSort).toBe('Asimov, Isaac');
    expect(meta.authorSort).toBe('');
  });

  it('parses authorSort from dc:creator file-as attribute independently', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Foundation</dc:title>
    <dc:creator file-as="Asimov, Isaac">Isaac Asimov</dc:creator>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'foundation-creator-fileas.epub');
    fs.writeFileSync(filePath, zip.toBuffer());

    const meta = parseEpub(filePath);

    expect(meta.author).toBe('Isaac Asimov');
    expect(meta.authorSort).toBe('Asimov, Isaac');
    expect(meta.titleSort).toBe('');
  });

  it('does not fall back to authorSort when titleSort is absent', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>No Title Sort</dc:title>
    <dc:creator file-as="Sort, Author">Author Name</dc:creator>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'no-title-sort.epub');
    fs.writeFileSync(filePath, zip.toBuffer());

    const meta = parseEpub(filePath);

    expect(meta.titleSort).toBe('');
    expect(meta.authorSort).toBe('Sort, Author');
  });

  it('parses a valid ISO 8601 date from dc:date', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Dated Book</dc:title>
    <dc:date>2001-01-16</dc:date>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'dated.epub');
    fs.writeFileSync(filePath, zip.toBuffer());

    expect(parseEpub(filePath).publishDate).toBe('2001-01-16');
  });

  it('accepts partial ISO 8601 dates (year only, year-month)', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Year Book</dc:title>
    <dc:date>2001</dc:date>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'year-only.epub');
    fs.writeFileSync(filePath, zip.toBuffer());

    expect(parseEpub(filePath).publishDate).toBe('2001');
  });

  it('discards an invalid dc:date value and returns empty string', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Bad Date Book</dc:title>
    <dc:date>not-a-date</dc:date>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'bad-date.epub');
    fs.writeFileSync(filePath, zip.toBuffer());

    expect(parseEpub(filePath).publishDate).toBe('');
  });

  it('returns empty publishDate when dc:date is absent', () => {
    const filePath = path.join(tmpDir, 'no-date.epub');
    fs.writeFileSync(filePath, makeEpub({ title: 'No Date' }));

    expect(parseEpub(filePath).publishDate).toBe('');
  });

  it('parses publishDate from object-shaped dc:date (attributes present)', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Object Date Book</dc:title>
    <dc:date opf:event="publication">2023-05-01</dc:date>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'object-date.epub');
    fs.writeFileSync(filePath, zip.toBuffer());

    expect(parseEpub(filePath).publishDate).toBe('2023-05-01');
  });

  it('parses publishDate from first element of array-shaped dc:date', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Array Date Book</dc:title>
    <dc:date>2022-03-15</dc:date>
    <dc:date>2024-01-01</dc:date>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'array-date.epub');
    fs.writeFileSync(filePath, zip.toBuffer());

    expect(parseEpub(filePath).publishDate).toBe('2022-03-15');
  });

  it('parses cover image', () => {
    const coverBuf = Buffer.from('fake-jpeg-data');
    const filePath = path.join(tmpDir, 'book.epub');
    fs.writeFileSync(
      filePath,
      makeEpub({ title: 'T', coverData: coverBuf, coverMime: 'image/jpeg' })
    );
    const meta = parseEpub(filePath);
    expect(meta.coverData).toEqual(coverBuf);
    expect(meta.coverMime).toBe('image/jpeg');
  });

  it('throws on malformed ZIP', () => {
    const filePath = path.join(tmpDir, 'bad.epub');
    fs.writeFileSync(filePath, Buffer.from('not a zip file'));
    expect(() => parseEpub(filePath)).toThrow();
  });

  it('parses publisher', () => {
    const filePath = path.join(tmpDir, 'publisher.epub');
    fs.writeFileSync(filePath, makeEpub({ title: 'T', publisher: 'Penguin Books' }));
    const meta = parseEpub(filePath);
    expect(meta.publisher).toBe('Penguin Books');
  });

  it('returns empty publisher when absent', () => {
    const filePath = path.join(tmpDir, 'no-publisher.epub');
    fs.writeFileSync(filePath, makeEpub({ title: 'T' }));
    const meta = parseEpub(filePath);
    expect(meta.publisher).toBe('');
  });

  it('parses identifier with opf:scheme attribute', () => {
    const filePath = path.join(tmpDir, 'isbn-scheme.epub');
    fs.writeFileSync(
      filePath,
      makeEpub({ title: 'T', identifiers: [{ scheme: 'ISBN', value: '978-0593135204' }] })
    );
    const meta = parseEpub(filePath);
    expect(meta.identifiers).toEqual([{ scheme: 'ISBN', value: '978-0593135204' }]);
  });

  it('infers ISBN scheme from value starting with 978', () => {
    const filePath = path.join(tmpDir, 'isbn-infer.epub');
    fs.writeFileSync(
      filePath,
      makeEpub({ title: 'T', identifiers: [{ value: '978-0593135204' }] })
    );
    const meta = parseEpub(filePath);
    expect(meta.identifiers[0].scheme).toBe('ISBN');
    expect(meta.identifiers[0].value).toBe('978-0593135204');
  });

  it('infers UUID scheme from urn:uuid: prefix', () => {
    const filePath = path.join(tmpDir, 'uuid-infer.epub');
    fs.writeFileSync(
      filePath,
      makeEpub({ title: 'T', identifiers: [{ value: 'urn:uuid:abc1-2345' }] })
    );
    const meta = parseEpub(filePath);
    expect(meta.identifiers[0].scheme).toBe('UUID');
    expect(meta.identifiers[0].value).toBe('urn:uuid:abc1-2345');
  });

  it('skips identifiers with empty values', () => {
    const filePath = path.join(tmpDir, 'empty-id.epub');
    fs.writeFileSync(
      filePath,
      makeEpub({ title: 'T', identifiers: [{ scheme: 'ISBN', value: '' }] })
    );
    const meta = parseEpub(filePath);
    expect(meta.identifiers).toEqual([]);
  });

  it('infers ISBN scheme from urn:isbn: prefix', () => {
    const filePath = path.join(tmpDir, 'urn-isbn-infer.epub');
    fs.writeFileSync(
      filePath,
      makeEpub({ title: 'T', identifiers: [{ value: 'urn:isbn:978-0593135204' }] })
    );
    const meta = parseEpub(filePath);
    expect(meta.identifiers[0].scheme).toBe('ISBN');
    expect(meta.identifiers[0].value).toBe('urn:isbn:978-0593135204');
  });

  it('returns empty identifiers when absent', () => {
    const filePath = path.join(tmpDir, 'no-id.epub');
    fs.writeFileSync(filePath, makeEpub({ title: 'T' }));
    const meta = parseEpub(filePath);
    expect(meta.identifiers).toEqual([]);
  });

  it('parses multiple subjects', () => {
    const filePath = path.join(tmpDir, 'subjects.epub');
    fs.writeFileSync(
      filePath,
      makeEpub({ title: 'T', subjects: ['Science Fiction', 'Space Exploration'] })
    );
    const meta = parseEpub(filePath);
    expect(meta.subjects).toEqual(['Science Fiction', 'Space Exploration']);
  });

  it('returns empty subjects when absent', () => {
    const filePath = path.join(tmpDir, 'no-subjects.epub');
    fs.writeFileSync(filePath, makeEpub({ title: 'T' }));
    const meta = parseEpub(filePath);
    expect(meta.subjects).toEqual([]);
  });

  it('parses title as string when dc:title elements have xml attributes', () => {
    // EPUB3 books often have multiple <dc:title id="..."> elements.
    // fast-xml-parser returns each attributed element as an object like
    // { "@_id": "t1", "#text": "Death's End" } — the title must still be a string.
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title id="t1">Death's End</dc:title>
    <dc:title id="t2">死亡终结</dc:title>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'deaths-end.epub');
    fs.writeFileSync(filePath, zip.toBuffer());
    const meta = parseEpub(filePath);
    expect(typeof meta.title).toBe('string');
    expect(meta.title).toBe("Death's End");
  });

  it('picks english title when non-english variant appears first', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title xml:lang="zh">死亡终结</dc:title>
    <dc:title xml:lang="en">Death's End</dc:title>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'lang-title-en-last.epub');
    fs.writeFileSync(filePath, zip.toBuffer());
    const meta = parseEpub(filePath);
    expect(meta.title).toBe("Death's End");
  });

  it('falls back to no-lang title when english is absent', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Untranslated Title</dc:title>
    <dc:title xml:lang="zh">中文标题</dc:title>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'lang-title-nolang.epub');
    fs.writeFileSync(filePath, zip.toBuffer());
    const meta = parseEpub(filePath);
    expect(meta.title).toBe('Untranslated Title');
  });

  it('falls back to first title when no english or no-lang variant exists', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title xml:lang="de">Der Dunkle Wald</dc:title>
    <dc:title xml:lang="zh">黑暗森林</dc:title>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'lang-title-allforeign.epub');
    fs.writeFileSync(filePath, zip.toBuffer());
    const meta = parseEpub(filePath);
    expect(meta.title).toBe('Der Dunkle Wald');
  });

  it('picks english author when non-english variant appears first', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test</dc:title>
    <dc:creator xml:lang="zh">刘慈欣</dc:creator>
    <dc:creator xml:lang="en">Liu Cixin</dc:creator>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'lang-author-en-last.epub');
    fs.writeFileSync(filePath, zip.toBuffer());
    const meta = parseEpub(filePath);
    expect(meta.author).toBe('Liu Cixin');
  });

  it('falls back to no-lang author when english is absent', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test</dc:title>
    <dc:creator>Liu Cixin</dc:creator>
    <dc:creator xml:lang="zh">刘慈欣</dc:creator>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'lang-author-nolang.epub');
    fs.writeFileSync(filePath, zip.toBuffer());
    const meta = parseEpub(filePath);
    expect(meta.author).toBe('Liu Cixin');
  });

  it('falls back to first author when no english or no-lang variant exists', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test</dc:title>
    <dc:creator xml:lang="zh">刘慈欣</dc:creator>
    <dc:creator xml:lang="ja">劉慈欣</dc:creator>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'lang-author-allforeign.epub');
    fs.writeFileSync(filePath, zip.toBuffer());
    const meta = parseEpub(filePath);
    expect(meta.author).toBe('刘慈欣');
  });

  it('picks english series from multilingual belongs-to-collection', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test</dc:title>
    <meta id="collection-en" property="belongs-to-collection" xml:lang="en">Remembrance of Earth's Past</meta>
    <meta id="collection-zh" property="belongs-to-collection" xml:lang="zh-Hans">地球往事</meta>
    <meta property="collection-type">series</meta>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'lang-series-en.epub');
    fs.writeFileSync(filePath, zip.toBuffer());
    const meta = parseEpub(filePath);
    expect(meta.series).toBe("Remembrance of Earth's Past");
  });

  it('falls back to only available series when no english belongs-to-collection exists', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test</dc:title>
    <meta id="collection-zh" property="belongs-to-collection" xml:lang="zh-Hans">地球往事</meta>
    <meta property="collection-type">series</meta>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'lang-series-zh-only.epub');
    fs.writeFileSync(filePath, zip.toBuffer());
    const meta = parseEpub(filePath);
    expect(meta.series).toBe('地球往事');
  });

  it('prefers calibre:series over multilingual belongs-to-collection', () => {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test</dc:title>
    <meta name="calibre:series" content="Three Body"/>
    <meta name="calibre:series_index" content="1"/>
    <meta id="collection-en" property="belongs-to-collection" xml:lang="en">Remembrance of Earth's Past</meta>
    <meta id="collection-zh" property="belongs-to-collection" xml:lang="zh-Hans">地球往事</meta>
  </metadata>
  <manifest/><spine/>
</package>`)
    );
    const filePath = path.join(tmpDir, 'lang-series-calibre-wins.epub');
    fs.writeFileSync(filePath, zip.toBuffer());
    const meta = parseEpub(filePath);
    expect(meta.series).toBe('Three Body');
    expect(meta.seriesIndex).toBe(1);
  });

  describe('HTML entity decoding', () => {
    it('decodes double-encoded decimal entities in title (&#8212; from &amp;#8212;)', () => {
      // Some EPUB generators double-encode: &amp;#8212; in the XML → &#8212; after XML parse
      // → em dash after decodeEntities
      const filePath = path.join(tmpDir, 'entity-title.epub');
      fs.writeFileSync(filePath, makeEpub({ title: 'Part One&amp;#8212;The Beginning' }));
      const meta = parseEpub(filePath);
      expect(meta.title).toBe('Part One\u2014The Beginning');
    });

    it('decodes decimal entities in description (&#8220; &#8221; smart quotes)', () => {
      const filePath = path.join(tmpDir, 'entity-desc.epub');
      fs.writeFileSync(
        filePath,
        makeEpub({ title: 'T', description: '&amp;#8220;A great book.&amp;#8221;' })
      );
      const meta = parseEpub(filePath);
      expect(meta.description).toBe('\u201cA great book.\u201d');
    });

    it('decodes hex entities in title (&#x2014;)', () => {
      const filePath = path.join(tmpDir, 'entity-hex.epub');
      fs.writeFileSync(filePath, makeEpub({ title: 'Part One&amp;#x2014;The Beginning' }));
      const meta = parseEpub(filePath);
      expect(meta.title).toBe('Part One\u2014The Beginning');
    });

    it('decodes entities in publisher', () => {
      const filePath = path.join(tmpDir, 'entity-publisher.epub');
      fs.writeFileSync(filePath, makeEpub({ title: 'T', publisher: 'Caf&amp;#233; Press' }));
      const meta = parseEpub(filePath);
      expect(meta.publisher).toBe('Caf\u00e9 Press');
    });

    it('decodes entities in subjects', () => {
      const filePath = path.join(tmpDir, 'entity-subjects.epub');
      fs.writeFileSync(
        filePath,
        makeEpub({ title: 'T', subjects: ['Science &amp;#38; Technology'] })
      );
      const meta = parseEpub(filePath);
      expect(meta.subjects).toEqual(['Science \u0026 Technology']);
    });

    it('leaves plain text unchanged', () => {
      const filePath = path.join(tmpDir, 'entity-plain.epub');
      fs.writeFileSync(filePath, makeEpub({ title: 'Normal Title', description: 'A plain book.' }));
      const meta = parseEpub(filePath);
      expect(meta.title).toBe('Normal Title');
      expect(meta.description).toBe('A plain book.');
    });
  });

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

    it('returns only leaf nav entries in nested nav structure (leaf-only)', () => {
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
      // leaf-only: ch2 skipped (has child), so ch1(1) sec2a(3) ch3(4) returned
      expect(meta.chapterCount).toBe(3);
      expect(meta.chapterSpineMap).toEqual([1, 3, 4]);
    });

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
      [
        'cover.xhtml',
        'titlepage.xhtml',
        'copyright.xhtml',
        'dedication.xhtml',
        'map.xhtml',
        'ch1.xhtml',
      ].forEach((f) => zip.addFile(`OEBPS/${f}`, Buffer.from('<html/>')));
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

    it('decodes numeric HTML entities in chapter names from EPUB 3 nav', () => {
      const filePath = path.join(tmpDir, 'entity-nav-chapter.epub');
      fs.writeFileSync(
        filePath,
        makeEpubWithNav([
          { title: '3: you&#8217;re on your way', href: 'ch3.xhtml' },
          { title: '5: you&#8217;re not alone', href: 'ch5.xhtml' },
          { title: 'Part One&#8212;The Beginning', href: 'ch6.xhtml' },
        ])
      );
      const meta = parseEpub(filePath);
      expect(meta.chapterNames).toEqual([
        '3: you’re on your way',
        '5: you’re not alone',
        'Part One—The Beginning',
      ]);
    });

    it('decodes numeric HTML entities in chapter names from EPUB 2 NCX', () => {
      const filePath = path.join(tmpDir, 'entity-ncx-chapter.epub');
      fs.writeFileSync(
        filePath,
        makeEpubWithNcx([
          { title: '5: you&#8217;re not alone', href: 'ch5.xhtml' },
          { title: 'Part Two&#8212;The End', href: 'ch6.xhtml' },
        ])
      );
      const meta = parseEpub(filePath);
      expect(meta.chapterNames).toEqual(['5: you’re not alone', 'Part Two—The End']);
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

    it('keeps flat chapter entries alongside filtered hierarchical entries', () => {
      // "Title Page" is a flat leaf that is denied; "Introduction" is a flat leaf that is kept;
      // "Part I" is a parent (leaf-only excluded); its children ch1/ch2 are kept
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
    <item id="tp" href="tp.xhtml" media-type="application/xhtml+xml"/>
    <item id="intro" href="intro.xhtml" media-type="application/xhtml+xml"/>
    <item id="part1" href="part1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="tp"/>
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
        <li><a href="tp.xhtml">Title Page</a></li>
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
      ['tp.xhtml', 'intro.xhtml', 'part1.xhtml', 'ch1.xhtml', 'ch2.xhtml'].forEach((f) =>
        zip.addFile(`OEBPS/${f}`, Buffer.from('<html/>'))
      );
      const filePath = path.join(tmpDir, 'mixed-flat-hier.epub');
      fs.writeFileSync(filePath, zip.toBuffer());
      const meta = parseEpub(filePath);
      // tp (spine 0) denied, intro (spine 1) kept, part1 (spine 2) leaf-only excluded,
      // ch1 (spine 3) and ch2 (spine 4) kept
      expect(meta.chapterCount).toBe(3);
      expect(meta.chapterSpineMap).toEqual([1, 3, 4]);
      expect(meta.chapterNames).toEqual(['Introduction', 'Chapter 1', 'Chapter 2']);
    });
  });
});

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
    const p = writeTmp(makeEpub());
    expect(parseEpub(p).pageCount).toBe(0);
  });

  it('strips HTML tags before counting characters', () => {
    // <p>Hello</p> strips to "Hello" (5 chars) → 1 page
    const p = writeTmp(makeEpubWithSpine('<p>Hello</p>'));
    expect(parseEpub(p).pageCount).toBe(1);
  });
});

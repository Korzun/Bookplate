import fs from 'fs';
import os from 'os';
import path from 'path';

import AdmZip from 'adm-zip';
import sharp from 'sharp';

import { buildEdition } from './edition-builder';

vi.mock('../logger');

async function cover(): Promise<Buffer> {
  return sharp({
    create: { width: 120, height: 120, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

async function makeEpub(dir: string): Promise<string> {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
        `<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    )
  );
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">` +
        `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier>` +
        `<dc:title>T</dc:title><meta name="cover" content="cover-img"/></metadata>` +
        `<manifest><item id="cover-img" href="cover.jpg" media-type="image/jpeg"/>` +
        `<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>` +
        `<spine><itemref idref="c1"/></spine></package>`
    )
  );
  zip.addFile(
    'OEBPS/ch1.xhtml',
    Buffer.from(
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>He said <q>hi</q> 10&#8212;20</p></body></html>`
    )
  );
  zip.addFile('OEBPS/cover.jpg', await cover());
  const p = path.join(dir, 'src.epub');
  fs.writeFileSync(p, zip.toBuffer());
  return p;
}

// Parse the first local file header of a ZIP: its name and compression method.
// The OCF spec (and epubcheck PKG-006) requires the first entry to be
// `mimetype`, stored uncompressed (method 0).
function firstZipEntry(buf: Buffer): { name: string; method: number } {
  const method = buf.readUInt16LE(8);
  const nameLen = buf.readUInt16LE(26);
  const name = buf.subarray(30, 30 + nameLen).toString('latin1');
  return { name, method };
}

describe('buildEdition', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edition-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('simplifies content documents', async () => {
    const src = await makeEpub(dir);
    const out = await buildEdition(src, { simplify: true, cover: null });
    const text = new AdmZip(out).getEntry('OEBPS/ch1.xhtml')!.getData().toString('utf8');
    expect(text).toContain('“hi”'); // <q> -> typographic quotes
    expect(text).toContain('10—20'); // &#8212; -> em dash
    expect(text).not.toContain('<q>');
  });

  it('resizes and grayscales the cover in place', async () => {
    const src = await makeEpub(dir);
    const out = await buildEdition(src, {
      simplify: false,
      cover: { width: 60, height: null, fit: 'contain', grayscale: true },
    });
    const bytes = new AdmZip(out).getEntry('OEBPS/cover.jpg')!.getData();
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBe(60);
  });

  it('writes mimetype as the first, stored entry (OCF / epubcheck PKG-006)', async () => {
    const src = await makeEpub(dir);
    const out = await buildEdition(src, {
      simplify: true,
      cover: { width: 60, height: 80, fit: 'smart', grayscale: true },
    });
    const first = firstZipEntry(out);
    expect(first.name).toBe('mimetype');
    expect(first.method).toBe(0); // stored, not deflated
  });
});

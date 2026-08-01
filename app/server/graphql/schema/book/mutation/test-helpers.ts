import * as fs from 'fs';
import * as path from 'path';

import AdmZip from 'adm-zip';

import type { Severity } from '../../../../services/epub-validator';
import type { EpubMeta, Owner } from '../../../../types';
import type { Harness } from '../../../test-util';

/** Every severity at zero — the shape `Validation.counts`/`EpubValidationError` require. */
export const EMPTY_COUNTS: Record<Severity, number> = {
  FATAL: 0,
  ERROR: 0,
  WARNING: 0,
  INFO: 0,
  USAGE: 0,
};

/**
 * The smallest EPUB `epub-parser`/`epub-writer` will round-trip: a container
 * pointing at one OPF with a `dc:title`, one manifest item, an empty spine.
 * Mirrors `apply-epub-changes.test.ts`'s `epub()` fixture exactly — same
 * shape, proven to survive a real (unmocked) `reimportBook`/`buildUpdatedEpub`
 * round trip there.
 */
export function fixtureEpub(title: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    )
  );
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"/></package>`
    )
  );
  return zip.toBuffer();
}

const fakeMeta = (title: string): EpubMeta => ({
  title,
  titleSort: '',
  authorSort: '',
  publishDate: '',
  author: 'Seed Author',
  description: '',
  publisher: '',
  series: '',
  seriesIndex: 0,
  identifiers: [],
  subjects: [],
  coverData: null,
  coverMime: null,
  chapterCount: 0,
  chapterSpineMap: [],
  chapterNames: [],
  pageCount: 0,
});

/**
 * Seeds a real, on-disk, editable book: a real EPUB file (so `applyEpubChanges`'s
 * real `buildUpdatedEpub`/`reimportBook` round trip has real bytes to work
 * with), a real `Book` row (`BookStore.addBook`), and — unless `opts.valid` says
 * otherwise — a `Validation` row marking it `valid: true`, mirroring what a real
 * scan does and satisfying `bookUpdateMetadata`'s REST-mirrored `book.valid !==
 * true` gate.
 */
export async function seedEditableBook(
  harness: Harness,
  owner: Owner,
  id: string,
  title: string,
  opts: { valid?: boolean | null } = {}
): Promise<void> {
  const staged = path.join(harness.config.booksDir, `${owner.userId}-${id}-staged.epub`);
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  fs.writeFileSync(staged, fixtureEpub(title));
  await harness.stores.book.addBook(owner, id, staged, fakeMeta(title));

  // Not `opts.valid ?? true`: `??` treats an explicit `null` the same as
  // `undefined` and would silently replace it with `true`, defeating the
  // "never validated" test case this option exists for.
  const valid = opts.valid === undefined ? true : opts.valid;
  if (valid !== null) {
    await harness.stores.validation.saveValidation(owner, id, {
      valid,
      threshold: 'ERROR',
      messages: [],
      counts: EMPTY_COUNTS,
    });
  }
}

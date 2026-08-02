import * as fs from 'fs';
import * as path from 'path';

import { decodeGlobalID } from '@pothos/plugin-relay';
import AdmZip from 'adm-zip';

import type { Severity } from '../../../../services/epub-validator';
import type { EpubMeta, Owner } from '../../../../types';
import type { Harness } from '../../../test-util';
import { parseCompoundId } from '../../node-scope';

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
 * pointing at one OPF with a `dc:title` (and, when `author` is given, a
 * `dc:creator`), one manifest item, an empty spine. Mirrors `apply-epub-
 * changes.test.ts`'s `epub()` fixture exactly — same shape, proven to
 * survive a real (unmocked) `reimportBook`/`buildUpdatedEpub` round trip
 * there.
 *
 * `author` is optional (existing callers passing one argument are
 * unaffected) — pass it whenever a test exercises an author-sort fix:
 * `epub-writer.ts`'s `writeSortedField` attaches `opf:file-as` to the
 * `dc:creator` element itself, so an author-less candidate has no element
 * for the sort key to attach to and the write silently has nothing to do.
 */
export function fixtureEpub(title: string, author?: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    )
  );
  const creator = author !== undefined ? `<dc:creator>${author}</dc:creator>` : '';
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title>${creator}</metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"/></package>`
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

/**
 * Decodes a `Book` global ID back to its raw content-hash id — the inverse of
 * `encodeGlobalID('Book', JSON.stringify([userId, id]))`, which every book
 * mutation test uses to build the mutation's `id` input. Tests that need to
 * look up a post-mutation row by the id the RESPONSE actually reports (rather
 * than the id they sent — content-hash mutations like `bookRegenChapters`/
 * `bookUpdateMetadata`/`bookReplace`/`bookResolvePendingFix`'s auto-fix
 * branch may re-fingerprint the file and return a DIFFERENT id than the
 * input) decode the response's `id` this way, mirroring exactly what the
 * resolvers themselves do with `parseCompoundId` — rather than trusting a
 * same-object `bookId` selection (removed, `book/model.ts`).
 */
export const rawBookId = (globalId: string): string => {
  const parsed = parseCompoundId(decodeGlobalID(globalId).id);
  if (parsed === null) throw new Error(`not a Book global id: ${globalId}`);
  return parsed[1];
};

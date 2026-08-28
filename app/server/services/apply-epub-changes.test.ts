import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';
import AdmZip from 'adm-zip';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../logger');
// assertValidEpub: pass by default; toValidationReport real (needs a messages array).
vi.mock('./epub-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./epub-validator')>();
  return {
    ...actual,
    assertValidEpub: vi.fn().mockResolvedValue({
      valid: true,
      messages: [],
      counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
    }),
  };
});

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import type { Owner } from '../types';
import { replaceEpubBytes } from './apply-epub-changes';
import { BookHashCollisionError, BookStore } from './book-store';
import { assertValidEpub, EpubValidationError } from './epub-validator';

const OWNER: Owner = { userId: 'u1', username: 'alice' };
const FAKE_META = {
  title: 'T',
  author: 'A',
  series: '',
  seriesIndex: 0,
  publisher: '',
  publishDate: '',
  description: '',
  subjects: [],
  identifiers: [],
  coverData: null,
  coverMime: null,
  chapterCount: 0,
  chapterSpineMap: [],
  chapterNames: [],
  pageCount: 0,
} as never;

function epub(title: string): Buffer {
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

describe('replaceEpubBytes', () => {
  let tmpDir: string, booksDir: string, prisma: PrismaClient;
  let bookStore: BookStore;
  let deps: {
    bookStore: BookStore;
    prisma: PrismaClient;
    validationThreshold: 'ERROR';
  };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replace-'));
    booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
    await runMigrations(prisma, booksDir);
    await prisma.user.create({ data: { id: 'u1', username: 'alice', passwordHash: '' } as never });
    bookStore = new BookStore(booksDir, prisma);
    deps = { bookStore, prisma, validationThreshold: 'ERROR' };
    const staged = path.join(booksDir, 'staged.epub');
    fs.writeFileSync(staged, epub('Old'));
    await bookStore.addBook(OWNER, 'oldid', staged, FAKE_META);
  });
  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('swaps the file, reimports (new id), and saves validation', async () => {
    const updated = await replaceEpubBytes(
      deps,
      OWNER,
      (await bookStore.getBookById(OWNER, 'oldid'))!,
      epub('New')
    );
    expect(updated.id).not.toBe('oldid'); // fingerprint changed
    expect(updated.title).toBe('New'); // metadata re-derived
    expect(
      await prisma.validation.findUnique({
        where: { userId_bookId: { userId: OWNER.userId, bookId: updated.id } },
      })
    ).not.toBeNull();
    // lineage recorded old -> new
    const rows = await prisma.$queryRawUnsafe<Array<{ old_id: string }>>(
      `SELECT old_id FROM book_id_history WHERE user_id='u1' AND current_id=?`,
      updated.id
    );
    expect(rows.some((r) => r.old_id === 'oldid')).toBe(true);
  });

  it('throws EpubValidationError and leaves the file untouched on invalid bytes', async () => {
    (assertValidEpub as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new EpubValidationError(
        [],
        { FATAL: 1, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 } as never,
        'ERROR'
      )
    );
    const book = (await bookStore.getBookById(OWNER, 'oldid'))!;
    const before = fs.readFileSync(book.path);
    await expect(replaceEpubBytes(deps, OWNER, book, epub('Broken'))).rejects.toBeInstanceOf(
      EpubValidationError
    );
    expect(fs.readFileSync(book.path).equals(before)).toBe(true);
  });

  it('restores the original bytes when reimport throws a collision', async () => {
    const book = (await bookStore.getBookById(OWNER, 'oldid'))!;
    const before = fs.readFileSync(book.path);
    vi.spyOn(bookStore, 'reimportBook').mockRejectedValueOnce(new BookHashCollisionError('dup'));

    await expect(replaceEpubBytes(deps, OWNER, book, epub('New'))).rejects.toBeInstanceOf(
      BookHashCollisionError
    );

    // Disk matches DB again: the failed swap left the original bytes in place.
    expect(fs.readFileSync(book.path).equals(before)).toBe(true);
  });
});

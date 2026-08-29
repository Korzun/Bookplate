import { randomUUID } from 'crypto';
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
    validateEpubReport: vi.fn().mockResolvedValue({
      valid: true,
      messages: [],
      counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
      threshold: 'ERROR',
    }),
  };
});

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import type { Book, EpubMeta, Owner } from '../types';
import { BookStore } from './book-store';
import { applyAutoAndAccepted, analyzeEpub, fixKey, toFix } from './epub-import-pipeline';
import { assertValidEpub, validateEpubReport } from './epub-validator';

const OWNER: Owner = { userId: 'u1', username: 'alice' };

const FAKE_META: EpubMeta = {
  title: 'The Test Title',
  titleSort: '',
  author: 'Ursula K. Le Guin',
  authorSort: '',
  publishDate: '',
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
};

// A candidate EPUB whose metadata triggers one auto-eligible fix
// (title-sort-missing, from the leading "The") and one proposal-only fix
// (author-sort-missing, low-confidence because "Le Guin" has a particle) —
// mirrors the fixture used by ui.test.ts's upload-detection tests.
function makeEpub(opts: { title?: string; author?: string; subjects?: string[] } = {}): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    )
  );
  const opf = `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${
    opts.title !== undefined ? `<dc:title>${opts.title}</dc:title>` : ''
  }${
    opts.author !== undefined ? `<dc:creator>${opts.author}</dc:creator>` : ''
  }${(opts.subjects ?? []).map((s) => `<dc:subject>${s}</dc:subject>`).join('')}</metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"/></package>`;
  zip.addFile('OEBPS/content.opf', Buffer.from(opf));
  return zip.toBuffer();
}

describe('epub-import-pipeline', () => {
  let tmpDir: string, booksDir: string, prisma: PrismaClient;
  let bookStore: BookStore;
  let deps: {
    bookStore: BookStore;
    prisma: PrismaClient;
    validationThreshold: 'ERROR';
  };

  beforeEach(async () => {
    // The vi.mock() factory above only sets these defaults once, at module
    // load; vite.config.ts's `mockReset: true` wipes them before every
    // test, so they must be re-armed here on each run.
    vi.mocked(assertValidEpub).mockResolvedValue({
      valid: true,
      messages: [],
      counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
    });
    vi.mocked(validateEpubReport).mockResolvedValue({
      valid: true,
      messages: [],
      counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
      threshold: 'ERROR',
    });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-'));
    booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
    await runMigrations(prisma, booksDir);
    await prisma.user.create({ data: { id: 'u1', username: 'alice', passwordHash: '' } as never });
    const editionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-editions-'));
    bookStore = new BookStore(booksDir, prisma, editionsRoot);
    deps = { bookStore, prisma, validationThreshold: 'ERROR' };
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function seedBook(id = 'book1'): Promise<Book> {
    const staged = path.join(booksDir, `staged-${randomUUID()}.epub`);
    fs.writeFileSync(staged, makeEpub({ title: FAKE_META.title, author: FAKE_META.author }));
    await bookStore.addBook(OWNER, id, staged, FAKE_META);
    return (await bookStore.getBookById(OWNER, id))!;
  }

  async function seedBookWithSubjects(id: string, subjects: string[]): Promise<Book> {
    const staged = path.join(booksDir, `staged-${randomUUID()}.epub`);
    fs.writeFileSync(
      staged,
      makeEpub({ title: FAKE_META.title, author: FAKE_META.author, subjects })
    );
    await bookStore.addBook(OWNER, id, staged, { ...FAKE_META, subjects });
    return (await bookStore.getBookById(OWNER, id))!;
  }

  describe('analyzeEpub', () => {
    it('reports valid, an auto-eligible fix, and a proposal without creating a book', async () => {
      const staged = path.join(booksDir, `staged-${randomUUID()}.epub`);
      fs.writeFileSync(staged, makeEpub({ title: FAKE_META.title, author: FAKE_META.author }));

      const result = await analyzeEpub(staged, {
        originalName: 'the-test-title.epub',
        librarySubjects: [],
        validationThreshold: 'ERROR',
      });

      expect(result.valid).toBe(true);
      expect(result.structuralFix).toBeNull();

      const autoFix = result.autoFixes.find((f) => f.kind === 'title-sort-missing');
      expect(autoFix).toBeTruthy();
      expect(autoFix?.to).toBe('Test Title, The');

      const proposal = result.proposals.find((f) => f.kind === 'author-sort-missing');
      expect(proposal).toBeTruthy();
      expect(proposal?.to).toBe('Guin, Ursula K. Le');

      // Read-only: no book created, staged file still present.
      expect(await bookStore.listBooks(OWNER)).toHaveLength(0);
      expect(fs.existsSync(staged)).toBe(true);
    });

    it('skips detection when skipDetect is set', async () => {
      const staged = path.join(booksDir, `staged-${randomUUID()}.epub`);
      fs.writeFileSync(staged, makeEpub({ title: FAKE_META.title, author: FAKE_META.author }));

      const result = await analyzeEpub(staged, {
        originalName: 'the-test-title.epub',
        librarySubjects: [],
        validationThreshold: 'ERROR',
        skipDetect: true,
      });

      expect(result.valid).toBe(true);
      expect(result.autoFixes).toEqual([]);
      expect(result.proposals).toEqual([]);
    });
  });

  describe('applyAutoAndAccepted', () => {
    it('applies auto-eligible fixes and returns the remaining proposal when acceptedKeys is empty', async () => {
      const book = await seedBook();

      const result = await applyAutoAndAccepted(deps, OWNER, book, {
        originalName: 'the-test-title.epub',
        librarySubjects: [],
        acceptedKeys: [],
      });

      expect(result.applied.some((f) => f.kind === 'title-sort-missing')).toBe(true);
      expect(result.book.titleSort).toBe('Test Title, The');
      // The low-confidence author-sort fix was not applied.
      expect(result.book.authorSort).toBe('');
      expect(result.applied.some((f) => f.kind === 'author-sort-missing')).toBe(false);

      const proposal = result.proposals.find((f) => f.kind === 'author-sort-missing');
      expect(proposal).toBeTruthy();
      expect(proposal?.to).toBe('Guin, Ursula K. Le');
    });

    it('applies an accepted proposal and drops it from the returned proposals', async () => {
      const book = await seedBook('book2');
      const acceptedKey = fixKey(
        toFix({
          field: 'authorSort',
          kind: 'author-sort-missing',
          from: '',
          to: 'Guin, Ursula K. Le',
          autoEligible: false,
          changes: { authorSort: 'Guin, Ursula K. Le' },
        })
      );

      const result = await applyAutoAndAccepted(deps, OWNER, book, {
        originalName: 'the-test-title.epub',
        librarySubjects: [],
        acceptedKeys: [acceptedKey],
      });

      expect(result.book.authorSort).toBe('Guin, Ursula K. Le');
      expect(result.applied.some((f) => f.kind === 'author-sort-missing')).toBe(true);
      expect(result.proposals.find((f) => f.kind === 'author-sort-missing')).toBeUndefined();
    });

    it('applies an accepted subjects-split by folding it into the book’s current subjects', async () => {
      const book = await seedBookWithSubjects('book-subj', ['Science Fiction, Fantasy']);
      // subjects-split carries its edit in fromChips/toChips, not `changes`.
      const acceptedKey = fixKey(
        toFix({
          field: 'subjects',
          kind: 'subjects-split',
          from: 'Science Fiction, Fantasy',
          to: 'Science Fiction, Fantasy',
          autoEligible: false,
          changes: {},
          fromChips: ['Science Fiction, Fantasy'],
          toChips: ['Science Fiction', 'Fantasy'],
        })
      );

      const result = await applyAutoAndAccepted(deps, OWNER, book, {
        originalName: 'the-test-title.epub',
        librarySubjects: [],
        acceptedKeys: [acceptedKey],
      });

      expect(result.book.subjects).toEqual(['Science Fiction', 'Fantasy']);
      expect(result.applied.some((f) => f.kind === 'subjects-split')).toBe(true);
      expect(result.proposals.find((f) => f.kind === 'subjects-split')).toBeUndefined();
    });
  });
});

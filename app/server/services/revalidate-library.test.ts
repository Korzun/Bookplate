import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../logger');
// Keep splitSubjects/formatMessages real (report construction uses them);
// only stub validateEpubReport so the pass doesn't run real epubcheck.
vi.mock('./epub-validator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./epub-validator')>()),
  validateEpubReport: vi.fn().mockResolvedValue({
    valid: true,
    messages: [],
    counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
    threshold: 'ERROR',
  }),
}));

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import type { Owner } from '../types';
import { BookStore } from './book-store';
import { validateEpubReport } from './epub-validator';
import { revalidateLibrary } from './revalidate-library';

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

describe('revalidateLibrary', () => {
  let tmpDir: string;
  let booksDir: string;
  let prisma: PrismaClient;
  let bookStore: BookStore;
  let editionsRoot: string;
  const owner: Owner = { userId: 'u1', username: 'alice' };

  async function seedBook(id: string): Promise<void> {
    const staged = path.join(booksDir, `staged-${id}.epub`);
    fs.writeFileSync(staged, 'x');
    await bookStore.addBook(owner, id, staged, FAKE_META);
  }

  beforeEach(async () => {
    // The vi.mock() factory above only sets this default once, at module
    // load; vite.config.ts's `mockReset: true` wipes it before every test,
    // so it must be re-armed here on each run.
    vi.mocked(validateEpubReport).mockResolvedValue({
      valid: true,
      messages: [],
      counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
      threshold: 'ERROR',
    });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reval-'));
    booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
    await runMigrations(prisma, booksDir);
    await prisma.user.create({ data: { id: 'u1', username: 'alice', passwordHash: '' } as never });
    editionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reval-editions-'));
    bookStore = new BookStore(booksDir, prisma, editionsRoot);
  });

  const readValidation = (bookId: string) =>
    prisma.validation.findUnique({
      where: { userId_bookId: { userId: owner.userId, bookId } },
    });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(editionsRoot, { recursive: true, force: true });
  });

  it('validates and persists every book', async () => {
    await seedBook('book1');
    await seedBook('book2');
    const summary = await revalidateLibrary(
      { prisma, booksRoot: booksDir, validationThreshold: 'ERROR' },
      owner
    );
    expect(summary).toEqual({ validated: 2, failed: 0 });
    expect(await readValidation('book1')).not.toBeNull();
    expect(await readValidation('book2')).not.toBeNull();
  });

  it('counts a book whose file is missing as failed and still validates the rest', async () => {
    await seedBook('book1');
    await seedBook('book2');
    // Remove book1's on-disk file so fs.readFileSync throws for it.
    fs.rmSync(path.join(booksDir, 'alice', 'book1.epub'));
    const summary = await revalidateLibrary(
      { prisma, booksRoot: booksDir, validationThreshold: 'ERROR' },
      owner
    );
    expect(summary).toEqual({ validated: 1, failed: 1 });
    expect(await readValidation('book1')).toBeNull();
    expect(await readValidation('book2')).not.toBeNull();
  });
});

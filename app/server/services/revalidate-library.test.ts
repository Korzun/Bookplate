import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../logger');
// Keep splitSubjects/formatMessages real (ValidationStore.getValidation uses them);
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
import { revalidateLibrary } from './revalidate-library';
import { ValidationStore } from './validation-store';

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
  let validationStore: ValidationStore;
  const owner: Owner = { userId: 'u1', username: 'alice' };

  async function seedBook(id: string): Promise<void> {
    const staged = path.join(booksDir, `staged-${id}.epub`);
    fs.writeFileSync(staged, 'x');
    await bookStore.addBook(owner, id, staged, FAKE_META);
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reval-'));
    booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
    await runMigrations(prisma, booksDir);
    await prisma.user.create({ data: { id: 'u1', username: 'alice', passwordHash: '' } as never });
    bookStore = new BookStore(booksDir, prisma);
    validationStore = new ValidationStore(prisma);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('validates and persists every book', async () => {
    await seedBook('book1');
    await seedBook('book2');
    const summary = await revalidateLibrary(
      { bookStore, validationStore, validationThreshold: 'ERROR' },
      owner
    );
    expect(summary).toEqual({ validated: 2, failed: 0 });
    expect(await validationStore.getValidation(owner, 'book1')).not.toBeNull();
    expect(await validationStore.getValidation(owner, 'book2')).not.toBeNull();
  });

  it('counts a book whose file is missing as failed and still validates the rest', async () => {
    await seedBook('book1');
    await seedBook('book2');
    // Remove book1's on-disk file so fs.readFileSync throws for it.
    fs.rmSync(path.join(booksDir, 'alice', 'book1.epub'));
    const summary = await revalidateLibrary(
      { bookStore, validationStore, validationThreshold: 'ERROR' },
      owner
    );
    expect(summary).toEqual({ validated: 1, failed: 1 });
    expect(await validationStore.getValidation(owner, 'book1')).toBeNull();
    expect(await validationStore.getValidation(owner, 'book2')).not.toBeNull();
  });
});

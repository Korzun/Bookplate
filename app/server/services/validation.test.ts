import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import type { Owner } from '../types';
import { BookStore } from './book-store';
import type { ValidationReport } from './epub-validator';
import { saveValidation } from './validation';

vi.mock('../logger');

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

function report(valid: boolean): ValidationReport {
  return {
    valid,
    threshold: 'ERROR',
    counts: { FATAL: 0, ERROR: valid ? 0 : 1, WARNING: 1, INFO: 0, USAGE: 0 },
    messages: [
      {
        id: 'HTM-004',
        severity: 'WARNING',
        message: 'Attribute "x" not allowed',
        segments: [],
        location: { path: 'c.xhtml', line: 2 },
      },
      ...(valid
        ? []
        : [{ id: 'OPF-014', severity: 'ERROR' as const, message: 'boom', segments: [] }]),
    ],
  };
}

describe('saveValidation', () => {
  let tmpDir: string;
  let prisma: PrismaClient;
  let bookStore: BookStore;
  let editionsRoot: string;
  const owner: Owner = { userId: 'u1', username: 'alice' };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valstore-'));
    const booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
    await runMigrations(prisma, booksDir);
    // seed a user + a book row (FK targets)
    await prisma.user.create({ data: { id: 'u1', username: 'alice', passwordHash: '' } as never });
    editionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'valstore-editions-'));
    bookStore = new BookStore(booksDir, prisma, editionsRoot);
    const staged = path.join(booksDir, 'staged.epub');
    fs.writeFileSync(staged, 'x');
    await bookStore.addBook(owner, 'book1', staged, FAKE_META);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(editionsRoot, { recursive: true, force: true });
  });

  const readValidation = (bookId: string) =>
    prisma.validation.findUnique({
      where: { userId_bookId: { userId: owner.userId, bookId } },
      include: { messages: { orderBy: { seq: 'asc' } } },
    });

  it('writes no row when never validated', async () => {
    expect(await readValidation('book1')).toBeNull();
  });

  it('persists the report and its messages, ordered by seq', async () => {
    await saveValidation(prisma, owner, 'book1', report(false));
    const got = await readValidation('book1');
    expect(got).not.toBeNull();
    expect(got!.valid).toBe(false);
    expect(got!.threshold).toBe('ERROR');
    expect(got!.validatedAt).toEqual(expect.any(Number));
    expect(got!.messages.map((m) => m.code)).toEqual(['HTM-004', 'OPF-014']);
    expect(got!.messages.map((m) => m.severity)).toEqual(['WARNING', 'ERROR']);
    expect(got!.messages[0]).toMatchObject({ path: 'c.xhtml', line: 2, column: null });
  });

  it('upsert replaces prior messages', async () => {
    await saveValidation(prisma, owner, 'book1', report(false)); // 2 messages
    await saveValidation(prisma, owner, 'book1', report(true)); // 1 message, valid
    const got = await readValidation('book1');
    expect(got!.valid).toBe(true);
    expect(got!.messages.map((m) => m.code)).toEqual(['HTM-004']);
  });

  it('cascades on book delete', async () => {
    await saveValidation(prisma, owner, 'book1', report(false));
    await bookStore.deleteBook(owner, 'book1');
    expect(await readValidation('book1')).toBeNull();
  });
});

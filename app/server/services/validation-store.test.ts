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
import { ValidationStore } from './validation-store';

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

describe('ValidationStore', () => {
  let tmpDir: string;
  let prisma: PrismaClient;
  let bookStore: BookStore;
  let store: ValidationStore;
  const owner: Owner = { userId: 'u1', username: 'alice' };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valstore-'));
    const booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
    await runMigrations(prisma, booksDir);
    // seed a user + a book row (FK targets)
    await prisma.user.create({ data: { id: 'u1', username: 'alice', passwordHash: '' } as never });
    bookStore = new BookStore(booksDir, prisma);
    const staged = path.join(booksDir, 'staged.epub');
    fs.writeFileSync(staged, 'x');
    await bookStore.addBook(owner, 'book1', staged, FAKE_META);
    store = new ValidationStore(prisma);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when never validated', async () => {
    expect(await store.getValidation(owner, 'book1')).toBeNull();
  });

  it('round-trips a saved report with derived counts and segments, ordered by seq', async () => {
    await store.saveValidation(owner, 'book1', report(false));
    const got = await store.getValidation(owner, 'book1');
    expect(got).not.toBeNull();
    expect(got!.valid).toBe(false);
    expect(got!.threshold).toBe('ERROR');
    expect(got!.validatedAt).toBeInstanceOf(Date);
    expect(got!.messages.map((m) => m.id)).toEqual(['HTM-004', 'OPF-014']);
    expect(got!.counts).toEqual({ FATAL: 0, ERROR: 1, WARNING: 1, INFO: 0, USAGE: 0 });
    // segments recomputed from the message text
    expect(got!.messages[0].segments).toEqual([
      { text: 'Attribute ' },
      { text: 'x', subject: true },
      { text: ' not allowed' },
    ]);
    expect(got!.messages[0].location).toEqual({ path: 'c.xhtml', line: 2, column: undefined });
  });

  it('upsert replaces prior messages', async () => {
    await store.saveValidation(owner, 'book1', report(false)); // 2 messages
    await store.saveValidation(owner, 'book1', report(true)); // 1 message, valid
    const got = await store.getValidation(owner, 'book1');
    expect(got!.valid).toBe(true);
    expect(got!.messages.map((m) => m.id)).toEqual(['HTM-004']);
  });

  it('cascades on book delete', async () => {
    await store.saveValidation(owner, 'book1', report(false));
    await bookStore.deleteBook(owner, 'book1');
    expect(await store.getValidation(owner, 'book1')).toBeNull();
  });
});

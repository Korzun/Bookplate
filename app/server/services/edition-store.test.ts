import fs from 'fs';
import os from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { runMigrations } from '../db/migrate';
import { EditionStore, EditionDeps } from './edition-store';
import { EpubValidationError } from './epub-validator';
import { ValidationThreshold, Report, Severity } from '@korzun/epubcheck-ts';
import { Book, Device, Owner } from '../types';

jest.mock('../logger');

let prisma: PrismaClient, dbPath: string, root: string;

const owner: Owner = { userId: 'u1', username: 'alice' };

function makeBook(partial: Partial<Book> = {}): Book {
  return {
    id: 'bookA',
    filename: 'Orig.epub',
    path: '/src/orig.epub',
    title: 'Title',
    titleSort: 'Title',
    authorSort: 'Author',
    publishDate: '',
    author: 'Author',
    description: '',
    publisher: '',
    series: '',
    seriesIndex: 0,
    identifiers: [],
    subjects: [],
    hasCover: false,
    size: 0,
    mtime: new Date(1000),
    addedAt: new Date(0),
    chapterCount: 0,
    chapterSpineMap: [],
    chapterNames: [],
    pageCount: 0,
    ...partial,
  };
}

const book: Book = makeBook();

const device: Device = {
  id: 'devK',
  slug: 'kindle',
  name: 'Kindle',
  coverWidth: 60,
  coverHeight: null,
  coverFit: 'contain',
  bwCover: true,
  simplify: true,
};

const EMPTY_COUNTS: Record<Severity, number> = {
  FATAL: 0,
  ERROR: 0,
  WARNING: 0,
  INFO: 0,
  USAGE: 0,
};

function report(): Report {
  return {
    messages: [],
    counts: EMPTY_COUNTS,
    threshold: ValidationThreshold.ERROR,
    fatal: false,
    valid: true,
  };
}

beforeEach(async () => {
  const booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-'));
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'editions-'));
  dbPath = path.join(os.tmpdir(), `ed-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
});
afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* ignore */
  }
});

function store(deps: EditionDeps): EditionStore {
  return new EditionStore(root, prisma, deps);
}

it('generates, caches, and records the edition; second call is a cache hit', async () => {
  let builds = 0;
  const deps: EditionDeps = {
    buildEdition: async () => {
      builds++;
      return Buffer.from('EDITION-BYTES');
    },
    assertValidEpub: async () => report(),
    partialMD5: () => 'editionHash1',
  };
  const s = store(deps);
  const r1 = await s.getOrCreateEdition(owner, book, device, ValidationThreshold.ERROR);
  expect(fs.readFileSync(r1.path).toString()).toBe('EDITION-BYTES');
  expect(r1.filename).toBe('Orig.epub');
  const row = await prisma.deviceEdition.findFirst();
  expect(row?.editionId).toBe('editionHash1');

  const r2 = await s.getOrCreateEdition(owner, book, device, ValidationThreshold.ERROR);
  expect(r2.path).toBe(r1.path);
  expect(builds).toBe(1); // no rebuild
});

it('falls back to the original when validation fails', async () => {
  const deps: EditionDeps = {
    buildEdition: async () => Buffer.from('BAD'),
    assertValidEpub: async () => {
      throw new EpubValidationError([], EMPTY_COUNTS, ValidationThreshold.ERROR);
    },
    partialMD5: () => 'x',
  };
  const r = await store(deps).getOrCreateEdition(owner, book, device, ValidationThreshold.ERROR);
  expect(r.path).toBe(book.path);
  expect(await prisma.deviceEdition.findFirst()).toBeNull();
});

it('falls back to the original when persisting the edition fails', async () => {
  const deps: EditionDeps = {
    buildEdition: async () => Buffer.from('EDITION-BYTES'),
    assertValidEpub: async () => report(),
    partialMD5: () => {
      throw new Error('hash boom');
    },
  };
  const r = await store(deps).getOrCreateEdition(owner, book, device, ValidationThreshold.ERROR);
  expect(r.path).toBe(book.path);
  expect(r.filename).toBe(book.filename);
  expect(await prisma.deviceEdition.findFirst()).toBeNull();
});

it('short-circuits to the original for a no-transform device', async () => {
  const noop: Device = {
    ...device,
    coverWidth: null,
    coverHeight: null,
    bwCover: false,
    simplify: false,
  };
  const buildEditionSpy = jest.fn(async () => Buffer.from('SHOULD-NOT-BUILD'));
  const deps: EditionDeps = {
    buildEdition: buildEditionSpy,
    assertValidEpub: async () => report(),
    partialMD5: () => 'x',
  };
  const r = await store(deps).getOrCreateEdition(owner, book, noop, ValidationThreshold.ERROR);
  expect(r.path).toBe(book.path);
  expect(buildEditionSpy).not.toHaveBeenCalled();
});

it('purgeForDevice removes rows and files', async () => {
  const deps: EditionDeps = {
    buildEdition: async () => Buffer.from('E'),
    assertValidEpub: async () => report(),
    partialMD5: () => 'h',
  };
  const s = store(deps);
  await s.getOrCreateEdition(owner, book, device, ValidationThreshold.ERROR);
  await s.purgeForDevice(device.id);
  expect(await prisma.deviceEdition.count()).toBe(0);
  expect(fs.existsSync(path.join(root, device.id))).toBe(false);
});

it('purgeForUser removes rows and files across devices, leaving other users intact', async () => {
  const otherOwner: Owner = { userId: 'u2', username: 'bob' };
  const device2: Device = { ...device, id: 'devP', slug: 'phone', name: 'Phone' };
  const deps: EditionDeps = {
    buildEdition: async () => Buffer.from('E'),
    assertValidEpub: async () => report(),
    partialMD5: () => 'h',
  };
  const s = store(deps);
  await s.getOrCreateEdition(owner, book, device, ValidationThreshold.ERROR);
  await s.getOrCreateEdition(owner, book, device2, ValidationThreshold.ERROR);
  await s.getOrCreateEdition(otherOwner, book, device, ValidationThreshold.ERROR);

  await s.purgeForUser(owner.userId);

  expect(await prisma.deviceEdition.count({ where: { userId: owner.userId } })).toBe(0);
  expect(fs.existsSync(path.join(root, device.id, owner.userId, `${book.id}.epub`))).toBe(false);
  expect(fs.existsSync(path.join(root, device2.id, owner.userId, `${book.id}.epub`))).toBe(false);

  // Other user's edition on the same device is untouched.
  expect(await prisma.deviceEdition.count({ where: { userId: otherOwner.userId } })).toBe(1);
  expect(fs.existsSync(path.join(root, device.id, otherOwner.userId, `${book.id}.epub`))).toBe(
    true
  );
});

it("countForBook counts a book's editions for the user, ignoring other users/books", async () => {
  const deps: EditionDeps = {
    buildEdition: async () => Buffer.from('E'),
    assertValidEpub: async () => report(),
    partialMD5: () => 'h',
  };
  const s = store(deps);
  const device2: Device = { ...device, id: 'devP', slug: 'phone', name: 'Phone' };
  const otherOwner: Owner = { userId: 'u2', username: 'bob' };
  await s.getOrCreateEdition(owner, book, device, ValidationThreshold.ERROR);
  await s.getOrCreateEdition(owner, book, device2, ValidationThreshold.ERROR);
  await s.getOrCreateEdition(otherOwner, book, device, ValidationThreshold.ERROR);

  expect(await s.countForBook(owner.userId, book.id)).toBe(2);
  expect(await s.countForBook(owner.userId, 'nonexistent')).toBe(0);
});

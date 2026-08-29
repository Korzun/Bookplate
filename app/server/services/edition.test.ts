import fs from 'fs';
import os from 'os';
import path from 'path';

import { ValidationThreshold, Report, Severity } from '@korzun/epubcheck-ts';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { Book, Device, Owner } from '../types';
import {
  countForBook,
  getOrCreateEdition,
  purgeForDevice,
  purgeForDeviceAndUser,
  purgeForUser,
} from './edition';
import { buildEdition } from './edition-builder';
import { partialMD5 } from './epub-parser';
import { assertValidEpub, EpubValidationError } from './epub-validator';

vi.mock('../logger');
vi.mock('./edition-builder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./edition-builder')>()),
  buildEdition: vi.fn((await importOriginal<typeof import('./edition-builder')>()).buildEdition),
}));
vi.mock('./epub-parser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./epub-parser')>()),
  partialMD5: vi.fn((await importOriginal<typeof import('./epub-parser')>()).partialMD5),
}));
vi.mock('./epub-validator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./epub-validator')>()),
  assertValidEpub: vi.fn(
    (await importOriginal<typeof import('./epub-validator')>()).assertValidEpub
  ),
}));

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
  // Mock reset (implementations, queued once-behaviors, call history) is
  // handled globally by vite.config.ts's `mockReset: true`, which restores
  // the buildEdition/assertValidEpub/partialMD5 vi.fn(impl) mocks here to
  // their call-through default before each test.
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* ignore */
  }
});

it('generates, caches, and records the edition; second call is a cache hit', async () => {
  let builds = 0;
  vi.mocked(buildEdition).mockImplementation(async () => {
    builds++;
    return Buffer.from('EDITION-BYTES');
  });
  vi.mocked(assertValidEpub).mockResolvedValueOnce(report()).mockResolvedValueOnce(report());
  vi.mocked(partialMD5).mockReturnValueOnce('editionHash1');

  const r1 = await getOrCreateEdition(prisma, root, owner, book, device, ValidationThreshold.ERROR);
  expect(fs.readFileSync(r1.path).toString()).toBe('EDITION-BYTES');
  expect(r1.filename).toBe('Orig.epub');
  const row = await prisma.deviceEdition.findFirst();
  expect(row?.editionId).toBe('editionHash1');

  const r2 = await getOrCreateEdition(prisma, root, owner, book, device, ValidationThreshold.ERROR);
  expect(r2.path).toBe(r1.path);
  expect(builds).toBe(1); // no rebuild
});

it('falls back to the original when validation fails', async () => {
  vi.mocked(buildEdition).mockResolvedValueOnce(Buffer.from('BAD'));
  vi.mocked(assertValidEpub).mockImplementationOnce(async () => {
    throw new EpubValidationError([], EMPTY_COUNTS, ValidationThreshold.ERROR);
  });

  const r = await getOrCreateEdition(prisma, root, owner, book, device, ValidationThreshold.ERROR);
  expect(r.path).toBe(book.path);
  expect(await prisma.deviceEdition.findFirst()).toBeNull();
});

it('falls back to the original when persisting the edition fails', async () => {
  vi.mocked(buildEdition).mockResolvedValueOnce(Buffer.from('EDITION-BYTES'));
  vi.mocked(assertValidEpub).mockResolvedValueOnce(report());
  vi.mocked(partialMD5).mockImplementationOnce(() => {
    throw new Error('hash boom');
  });

  const r = await getOrCreateEdition(prisma, root, owner, book, device, ValidationThreshold.ERROR);
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
  vi.mocked(buildEdition).mockImplementationOnce(async () => Buffer.from('SHOULD-NOT-BUILD'));

  const r = await getOrCreateEdition(prisma, root, owner, book, noop, ValidationThreshold.ERROR);
  expect(r.path).toBe(book.path);
  expect(buildEdition).not.toHaveBeenCalled();
});

it('purgeForDevice removes rows and files', async () => {
  vi.mocked(buildEdition).mockResolvedValueOnce(Buffer.from('E'));
  vi.mocked(assertValidEpub).mockResolvedValueOnce(report());
  vi.mocked(partialMD5).mockReturnValueOnce('h');

  await getOrCreateEdition(prisma, root, owner, book, device, ValidationThreshold.ERROR);
  await purgeForDevice(prisma, root, device.id);
  expect(await prisma.deviceEdition.count()).toBe(0);
  expect(fs.existsSync(path.join(root, device.id))).toBe(false);
});

it('purgeForUser removes rows and files across devices, leaving other users intact', async () => {
  const otherOwner: Owner = { userId: 'u2', username: 'bob' };
  const device2: Device = { ...device, id: 'devP', slug: 'phone', name: 'Phone' };
  vi.mocked(buildEdition).mockResolvedValue(Buffer.from('E'));
  vi.mocked(assertValidEpub).mockResolvedValue(report());
  vi.mocked(partialMD5).mockReturnValue('h');

  await getOrCreateEdition(prisma, root, owner, book, device, ValidationThreshold.ERROR);
  await getOrCreateEdition(prisma, root, owner, book, device2, ValidationThreshold.ERROR);
  await getOrCreateEdition(prisma, root, otherOwner, book, device, ValidationThreshold.ERROR);

  await purgeForUser(prisma, root, owner.userId);

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
  const device2: Device = { ...device, id: 'devP', slug: 'phone', name: 'Phone' };
  const otherOwner: Owner = { userId: 'u2', username: 'bob' };
  vi.mocked(buildEdition).mockResolvedValue(Buffer.from('E'));
  vi.mocked(assertValidEpub).mockResolvedValue(report());
  vi.mocked(partialMD5).mockReturnValue('h');

  await getOrCreateEdition(prisma, root, owner, book, device, ValidationThreshold.ERROR);
  await getOrCreateEdition(prisma, root, owner, book, device2, ValidationThreshold.ERROR);
  await getOrCreateEdition(prisma, root, otherOwner, book, device, ValidationThreshold.ERROR);

  expect(await countForBook(prisma, owner.userId, book.id)).toBe(2);
  expect(await countForBook(prisma, owner.userId, 'nonexistent')).toBe(0);
});

it('purgeForDeviceAndUser removes only that user+device editions, leaving others intact', async () => {
  const otherOwner: Owner = { userId: 'u2', username: 'bob' };
  const device2: Device = { ...device, id: 'devP', slug: 'phone', name: 'Phone' };
  vi.mocked(buildEdition).mockResolvedValue(Buffer.from('E'));
  vi.mocked(assertValidEpub).mockResolvedValue(report());
  vi.mocked(partialMD5).mockReturnValue('h');

  await getOrCreateEdition(prisma, root, owner, book, device, ValidationThreshold.ERROR);
  await getOrCreateEdition(prisma, root, owner, book, device2, ValidationThreshold.ERROR);
  await getOrCreateEdition(prisma, root, otherOwner, book, device, ValidationThreshold.ERROR);

  await purgeForDeviceAndUser(prisma, root, device.id, owner.userId);

  // Target pair gone (row + file).
  expect(
    await prisma.deviceEdition.count({ where: { deviceId: device.id, userId: owner.userId } })
  ).toBe(0);
  expect(fs.existsSync(path.join(root, device.id, owner.userId, `${book.id}.epub`))).toBe(false);

  // Same user on a different device is untouched.
  expect(
    await prisma.deviceEdition.count({ where: { deviceId: device2.id, userId: owner.userId } })
  ).toBe(1);
  expect(fs.existsSync(path.join(root, device2.id, owner.userId, `${book.id}.epub`))).toBe(true);

  // Other user on the same device is untouched.
  expect(
    await prisma.deviceEdition.count({ where: { deviceId: device.id, userId: otherOwner.userId } })
  ).toBe(1);
  expect(fs.existsSync(path.join(root, device.id, otherOwner.userId, `${book.id}.epub`))).toBe(
    true
  );
});

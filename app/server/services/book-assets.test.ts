import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { EpubMeta, Owner } from '../types';
import {
  getCover,
  getMissingThumbnailPairs,
  getThumbnail,
  pruneThumbnails,
  saveThumbnail,
} from './book-assets';
import { BookStore } from './book-store';

vi.mock('../logger');

const OWNER: Owner = { userId: 'usr_test000000000000000', username: 'alice' };

function stage(id: string, content: string | Buffer = 'x'): string {
  const p = path.join(booksDir, `staged-${id}.epub`);
  fs.writeFileSync(p, content);
  return p;
}

const FAKE_META: EpubMeta = {
  title: 'Test Book',
  author: 'Author Name',
  description: 'A test description',
  publisher: 'Test Publisher',
  series: 'Test Series',
  seriesIndex: 1,
  titleSort: '',
  authorSort: '',
  publishDate: '',
  identifiers: [{ scheme: 'ISBN', value: '978-0000000000' }],
  subjects: ['Fiction'],
  coverData: Buffer.from('fake-cover'),
  coverMime: 'image/jpeg',
  chapterCount: 0,
  chapterSpineMap: [],
  chapterNames: [],
  pageCount: 0,
};

let prisma: PrismaClient;
let booksRoot: string;
// Per-user library folder (<booksRoot>/<OWNER.username>). Tests stage files here
// and assert on-disk paths here, matching the owner-scoped BookStore.
let booksDir: string;
let editionsRoot: string;
let bookStore: BookStore;
let dbPath: string;

beforeEach(async () => {
  booksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'books-test-'));
  booksDir = path.join(booksRoot, OWNER.username);
  fs.mkdirSync(booksDir, { recursive: true });
  editionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'books-test-editions-'));
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksRoot);
  await prisma.user.create({ data: { id: OWNER.userId, username: OWNER.username } });
  bookStore = new BookStore(booksRoot, prisma, editionsRoot);
});

afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
  fs.rmSync(booksRoot, { recursive: true });
});

describe('getCover', () => {
  it('returns cover data and mime', async () => {
    await bookStore.addBook(OWNER, 'cov1', stage('cov1'), FAKE_META);
    const cover = await getCover(prisma, OWNER.userId, 'cov1');
    expect(cover).not.toBeNull();
    expect(Buffer.from(cover!.data)).toEqual(Buffer.from('fake-cover'));
    expect(cover!.mime).toBe('image/jpeg');
  });

  it('returns null when no cover', async () => {
    await bookStore.addBook(OWNER, 'nocov', stage('nocov'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    expect(await getCover(prisma, OWNER.userId, 'nocov')).toBeNull();
  });

  it('returns null for unknown id', async () => {
    expect(await getCover(prisma, OWNER.userId, 'unknown')).toBeNull();
  });
});

describe('book_thumbnails', () => {
  it('saveThumbnail stores and getThumbnail retrieves', async () => {
    await bookStore.addBook(OWNER, 'bk1', stage('bk1'), FAKE_META);
    const data = Buffer.from('thumb-data');
    await saveThumbnail(prisma, OWNER.userId, 'bk1', 150, data, 'image/jpeg');
    const result = await getThumbnail(prisma, OWNER.userId, 'bk1', 150);
    expect(result).not.toBeNull();
    expect(Buffer.from(result!.data).toString()).toBe('thumb-data');
    expect(result!.mime).toBe('image/jpeg');
  });

  it('getThumbnail returns null when not present', async () => {
    await bookStore.addBook(OWNER, 'bk2', stage('bk2'), FAKE_META);
    expect(await getThumbnail(prisma, OWNER.userId, 'bk2', 150)).toBeNull();
  });

  it('saveThumbnail upserts on (book_id, width) conflict', async () => {
    await bookStore.addBook(OWNER, 'bk3', stage('bk3'), FAKE_META);
    await saveThumbnail(prisma, OWNER.userId, 'bk3', 150, Buffer.from('v1'), 'image/jpeg');
    await saveThumbnail(prisma, OWNER.userId, 'bk3', 150, Buffer.from('v2'), 'image/jpeg');
    expect(
      Buffer.from((await getThumbnail(prisma, OWNER.userId, 'bk3', 150))!.data).toString()
    ).toBe('v2');
  });

  it('pruneThumbnails removes rows whose width is not in the config list', async () => {
    await bookStore.addBook(OWNER, 'bk4', stage('bk4'), FAKE_META);
    await saveThumbnail(prisma, OWNER.userId, 'bk4', 60, Buffer.from('x'), 'image/jpeg');
    await saveThumbnail(prisma, OWNER.userId, 'bk4', 150, Buffer.from('y'), 'image/jpeg');
    await saveThumbnail(prisma, OWNER.userId, 'bk4', 300, Buffer.from('z'), 'image/jpeg');
    const removed = await pruneThumbnails(prisma, [60, 150]);
    expect(removed).toBe(1);
    expect(await getThumbnail(prisma, OWNER.userId, 'bk4', 60)).not.toBeNull();
    expect(await getThumbnail(prisma, OWNER.userId, 'bk4', 150)).not.toBeNull();
    expect(await getThumbnail(prisma, OWNER.userId, 'bk4', 300)).toBeNull();
  });

  it('pruneThumbnails with empty array removes all thumbnails', async () => {
    await bookStore.addBook(OWNER, 'bk5', stage('bk5'), FAKE_META);
    await saveThumbnail(prisma, OWNER.userId, 'bk5', 60, Buffer.from('x'), 'image/jpeg');
    const removed = await pruneThumbnails(prisma, []);
    expect(removed).toBe(1);
  });

  it('getMissingThumbnailPairs returns pairs without thumbnails', async () => {
    const metaWithCover = {
      ...FAKE_META,
      coverData: Buffer.from('cover'),
      coverMime: 'image/jpeg',
    };
    await bookStore.addBook(OWNER, 'bk6', stage('bk6'), metaWithCover);
    await bookStore.addBook(OWNER, 'bk7', stage('bk7'), metaWithCover);
    await saveThumbnail(prisma, OWNER.userId, 'bk6', 60, Buffer.from('x'), 'image/jpeg'); // already has 60px

    const missing = await getMissingThumbnailPairs(prisma, [60, 170]);
    // bk6 needs 170, bk7 needs both
    expect(missing).toContainEqual({ userId: OWNER.userId, bookId: 'bk6', width: 170 });
    expect(missing).toContainEqual({ userId: OWNER.userId, bookId: 'bk7', width: 60 });
    expect(missing).toContainEqual({ userId: OWNER.userId, bookId: 'bk7', width: 170 });
    expect(missing).not.toContainEqual({ userId: OWNER.userId, bookId: 'bk6', width: 60 });
  });

  it('getMissingThumbnailPairs ignores books without covers', async () => {
    await bookStore.addBook(OWNER, 'bk8', stage('bk8'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    const missing = await getMissingThumbnailPairs(prisma, [60]);
    expect(missing.map((p) => p.bookId)).not.toContain('bk8');
  });
});

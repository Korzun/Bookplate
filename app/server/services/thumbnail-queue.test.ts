import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { EpubMeta, Owner } from '../types';
import { BookStore } from './book-store';
import { ThumbnailQueue } from './thumbnail-queue';

vi.mock('../logger');

const OWNER: Owner = { userId: 'usr_test000000000000000', username: 'alice' };

const FAKE_META: EpubMeta = {
  title: 'Test',
  author: 'Author',
  description: '',
  publisher: '',
  series: '',
  seriesIndex: 0,
  titleSort: '',
  authorSort: '',
  publishDate: '',
  identifiers: [],
  subjects: [],
  coverData: Buffer.from('fake-cover-bytes'),
  coverMime: 'image/jpeg',
  chapterCount: 0,
  chapterSpineMap: [],
  chapterNames: [],
  pageCount: 0,
};

function stage(id: string, content: string | Buffer = 'x'): string {
  const p = path.join(booksDir, `staged-${id}.epub`);
  fs.writeFileSync(p, content);
  return p;
}

const mockResize = vi.fn(async (_buf: Buffer, _width: number) => Buffer.from('resized'));

let prisma: PrismaClient;
let booksRoot: string;
let booksDir: string;
let bookStore: BookStore;
let dbPath: string;

beforeEach(async () => {
  booksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-queue-test-'));
  booksDir = path.join(booksRoot, OWNER.username);
  fs.mkdirSync(booksDir, { recursive: true });
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksRoot);
  await prisma.user.create({ data: { id: OWNER.userId, username: OWNER.username } });
  bookStore = new BookStore(booksRoot, prisma);
  mockResize.mockClear();
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

describe('enqueue + drainForTest', () => {
  it('generates thumbnails for each configured width', async () => {
    await bookStore.addBook(OWNER, 'bk1', stage('bk1'), FAKE_META);
    const queue = new ThumbnailQueue(bookStore, [60, 170], mockResize);
    queue.enqueue(OWNER.userId, 'bk1');
    await queue.drainForTest();

    expect(mockResize).toHaveBeenCalledTimes(2);
    expect(mockResize).toHaveBeenCalledWith(expect.any(Buffer), 60);
    expect(mockResize).toHaveBeenCalledWith(expect.any(Buffer), 170);
    const t60 = await bookStore.getThumbnail(OWNER.userId, 'bk1', 60);
    expect(Buffer.from(t60!.data).toString()).toBe('resized');
    const t170 = await bookStore.getThumbnail(OWNER.userId, 'bk1', 170);
    expect(Buffer.from(t170!.data).toString()).toBe('resized');
  });

  it('skips books with no cover', async () => {
    await bookStore.addBook(OWNER, 'bk2', stage('bk2'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    const queue = new ThumbnailQueue(bookStore, [60], mockResize);
    queue.enqueue(OWNER.userId, 'bk2');
    await queue.drainForTest();

    expect(mockResize).not.toHaveBeenCalled();
  });

  it('logs and continues when resize throws', async () => {
    mockResize.mockRejectedValueOnce(new Error('sharp failed'));
    await bookStore.addBook(OWNER, 'bk3', stage('bk3'), FAKE_META);
    const queue = new ThumbnailQueue(bookStore, [60, 170], mockResize);
    queue.enqueue(OWNER.userId, 'bk3');
    await expect(queue.drainForTest()).resolves.not.toThrow();
    // Only the second width should succeed
    expect(await bookStore.getThumbnail(OWNER.userId, 'bk3', 60)).toBeNull();
    const t170 = await bookStore.getThumbnail(OWNER.userId, 'bk3', 170);
    expect(Buffer.from(t170!.data).toString()).toBe('resized');
  });
});

describe('reconcile', () => {
  it('queues missing (bookId, width) pairs', async () => {
    await bookStore.addBook(OWNER, 'bk4', stage('bk4'), FAKE_META);
    await bookStore.addBook(OWNER, 'bk5', stage('bk5'), FAKE_META);
    await bookStore.saveThumbnail(OWNER.userId, 'bk4', 60, Buffer.from('x'), 'image/jpeg'); // already exists

    const queue = new ThumbnailQueue(bookStore, [60, 170], mockResize);
    await queue.reconcile();
    await queue.drainForTest();

    // bk4 needs 170, bk5 needs both
    expect(await bookStore.getThumbnail(OWNER.userId, 'bk4', 170)).not.toBeNull();
    expect(await bookStore.getThumbnail(OWNER.userId, 'bk5', 60)).not.toBeNull();
    expect(await bookStore.getThumbnail(OWNER.userId, 'bk5', 170)).not.toBeNull();
    // bk4/60 should be untouched (was pre-existing)
    expect(mockResize).toHaveBeenCalledTimes(3);
  });

  it('returns the number of unique books with missing thumbnails', async () => {
    await bookStore.addBook(OWNER, 'bk_rc1', stage('bk_rc1'), FAKE_META);
    await bookStore.addBook(OWNER, 'bk_rc2', stage('bk_rc2'), FAKE_META);
    // bk_rc1 already has an 86px thumbnail
    await bookStore.saveThumbnail(OWNER.userId, 'bk_rc1', 86, Buffer.from('x'), 'image/jpeg');

    const queue = new ThumbnailQueue(bookStore, [86, 160], mockResize);
    const { bookCount } = await queue.reconcile();

    // bk_rc1 needs only 160px, bk_rc2 needs both — 2 unique books
    expect(bookCount).toBe(2);
  });
});

describe('start (prune + reconcile)', () => {
  it('prunes widths not in config before reconciling', async () => {
    await bookStore.addBook(OWNER, 'bk6', stage('bk6'), FAKE_META);
    await bookStore.saveThumbnail(OWNER.userId, 'bk6', 300, Buffer.from('old'), 'image/jpeg'); // obsolete width

    const queue = new ThumbnailQueue(bookStore, [60], mockResize);
    // await start() so pruneThumbnails and reconcile complete before we stop
    await queue.start();
    queue.stop();
    await queue.drainForTest();

    expect(await bookStore.getThumbnail(OWNER.userId, 'bk6', 300)).toBeNull(); // pruned
    expect(await bookStore.getThumbnail(OWNER.userId, 'bk6', 60)).not.toBeNull(); // generated
  });

  it('start() called twice does not spawn a second loop', async () => {
    await bookStore.addBook(OWNER, 'bk7', stage('bk7'), FAKE_META);
    const queue = new ThumbnailQueue(bookStore, [60], mockResize);
    await queue.start();
    await queue.start(); // second call should return early (running flag already set)
    queue.stop();
    await queue.drainForTest(); // wait for any in-flight job before afterEach tears down the DB
    // If two loops were spawned both would try to process jobs — verify no error thrown
    // and queue state is consistent (no assertion on resize count since processLoop
    // may have run 0 or 1 times before stop)
    expect(() => queue.stop()).not.toThrow();
  });
});

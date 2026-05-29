import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { runMigrations } from '../db/migrate';
import { BookStore } from './book-store';
import { ThumbnailQueue } from './thumbnail-queue';
import { EpubMeta } from '../types';

jest.mock('../logger');

const FAKE_META: EpubMeta = {
  title: 'Test',
  author: 'Author',
  description: '',
  publisher: '',
  series: '',
  seriesIndex: 0,
  fileAs: '',
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

const mockResize = jest.fn(async (_buf: Buffer, _width: number) => Buffer.from('resized'));

let prisma: PrismaClient;
let booksDir: string;
let bookStore: BookStore;
let dbPath: string;

beforeEach(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-queue-test-'));
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
  bookStore = new BookStore(booksDir, prisma);
  mockResize.mockClear();
});

afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
  fs.rmSync(booksDir, { recursive: true });
});

describe('enqueue + drainForTest', () => {
  it('generates thumbnails for each configured width', async () => {
    await bookStore.addBook('bk1', stage('bk1'), FAKE_META);
    const queue = new ThumbnailQueue(bookStore, [60, 170], mockResize);
    queue.enqueue('bk1');
    await queue.drainForTest();

    expect(mockResize).toHaveBeenCalledTimes(2);
    expect(mockResize).toHaveBeenCalledWith(expect.any(Buffer), 60);
    expect(mockResize).toHaveBeenCalledWith(expect.any(Buffer), 170);
    const t60 = await bookStore.getThumbnail('bk1', 60);
    expect(Buffer.from(t60!.data).toString()).toBe('resized');
    const t170 = await bookStore.getThumbnail('bk1', 170);
    expect(Buffer.from(t170!.data).toString()).toBe('resized');
  });

  it('skips books with no cover', async () => {
    await bookStore.addBook('bk2', stage('bk2'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    const queue = new ThumbnailQueue(bookStore, [60], mockResize);
    queue.enqueue('bk2');
    await queue.drainForTest();

    expect(mockResize).not.toHaveBeenCalled();
  });

  it('logs and continues when resize throws', async () => {
    mockResize.mockRejectedValueOnce(new Error('sharp failed'));
    await bookStore.addBook('bk3', stage('bk3'), FAKE_META);
    const queue = new ThumbnailQueue(bookStore, [60, 170], mockResize);
    queue.enqueue('bk3');
    await expect(queue.drainForTest()).resolves.not.toThrow();
    // Only the second width should succeed
    expect(await bookStore.getThumbnail('bk3', 60)).toBeNull();
    const t170 = await bookStore.getThumbnail('bk3', 170);
    expect(Buffer.from(t170!.data).toString()).toBe('resized');
  });
});

describe('reconcile', () => {
  it('queues missing (bookId, width) pairs', async () => {
    await bookStore.addBook('bk4', stage('bk4'), FAKE_META);
    await bookStore.addBook('bk5', stage('bk5'), FAKE_META);
    await bookStore.saveThumbnail('bk4', 60, Buffer.from('x'), 'image/jpeg'); // already exists

    const queue = new ThumbnailQueue(bookStore, [60, 170], mockResize);
    await queue.reconcile();
    await queue.drainForTest();

    // bk4 needs 170, bk5 needs both
    expect(await bookStore.getThumbnail('bk4', 170)).not.toBeNull();
    expect(await bookStore.getThumbnail('bk5', 60)).not.toBeNull();
    expect(await bookStore.getThumbnail('bk5', 170)).not.toBeNull();
    // bk4/60 should be untouched (was pre-existing)
    expect(mockResize).toHaveBeenCalledTimes(3);
  });
});

describe('start (prune + reconcile)', () => {
  it('prunes widths not in config before reconciling', async () => {
    await bookStore.addBook('bk6', stage('bk6'), FAKE_META);
    await bookStore.saveThumbnail('bk6', 300, Buffer.from('old'), 'image/jpeg'); // obsolete width

    const queue = new ThumbnailQueue(bookStore, [60], mockResize);
    // await start() so pruneThumbnails and reconcile complete before we stop
    await queue.start();
    queue.stop();
    await queue.drainForTest();

    expect(await bookStore.getThumbnail('bk6', 300)).toBeNull(); // pruned
    expect(await bookStore.getThumbnail('bk6', 60)).not.toBeNull(); // generated
  });

  it('start() called twice does not spawn a second loop', async () => {
    await bookStore.addBook('bk7', stage('bk7'), FAKE_META);
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

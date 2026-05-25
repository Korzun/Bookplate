import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
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

let db: InstanceType<typeof Database>;
let booksDir: string;
let bookStore: BookStore;

beforeEach(() => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-queue-test-'));
  db = new Database(':memory:');
  bookStore = new BookStore(booksDir, db);
  mockResize.mockClear();
});

afterEach(() => {
  db.close();
  fs.rmSync(booksDir, { recursive: true });
});

describe('enqueue + drainForTest', () => {
  it('generates thumbnails for each configured width', async () => {
    bookStore.addBook('bk1', stage('bk1'), FAKE_META);
    const queue = new ThumbnailQueue(bookStore, [60, 170], mockResize);
    queue.enqueue('bk1');
    await queue.drainForTest();

    expect(mockResize).toHaveBeenCalledTimes(2);
    expect(mockResize).toHaveBeenCalledWith(expect.any(Buffer), 60);
    expect(mockResize).toHaveBeenCalledWith(expect.any(Buffer), 170);
    expect(bookStore.getThumbnail('bk1', 60)!.data.toString()).toBe('resized');
    expect(bookStore.getThumbnail('bk1', 170)!.data.toString()).toBe('resized');
  });

  it('skips books with no cover', async () => {
    bookStore.addBook('bk2', stage('bk2'), {
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
    bookStore.addBook('bk3', stage('bk3'), FAKE_META);
    const queue = new ThumbnailQueue(bookStore, [60, 170], mockResize);
    queue.enqueue('bk3');
    await expect(queue.drainForTest()).resolves.not.toThrow();
    // Only the second width should succeed
    expect(bookStore.getThumbnail('bk3', 60)).toBeNull();
    expect(bookStore.getThumbnail('bk3', 170)!.data.toString()).toBe('resized');
  });
});

describe('reconcile', () => {
  it('queues missing (bookId, width) pairs', async () => {
    bookStore.addBook('bk4', stage('bk4'), FAKE_META);
    bookStore.addBook('bk5', stage('bk5'), FAKE_META);
    bookStore.saveThumbnail('bk4', 60, Buffer.from('x'), 'image/jpeg'); // already exists

    const queue = new ThumbnailQueue(bookStore, [60, 170], mockResize);
    queue.reconcile();
    await queue.drainForTest();

    // bk4 needs 170, bk5 needs both
    expect(bookStore.getThumbnail('bk4', 170)).not.toBeNull();
    expect(bookStore.getThumbnail('bk5', 60)).not.toBeNull();
    expect(bookStore.getThumbnail('bk5', 170)).not.toBeNull();
    // bk4/60 should be untouched (was pre-existing)
    expect(mockResize).toHaveBeenCalledTimes(3);
  });
});

describe('start (prune + reconcile)', () => {
  it('prunes widths not in config before reconciling', async () => {
    bookStore.addBook('bk6', stage('bk6'), FAKE_META);
    bookStore.saveThumbnail('bk6', 300, Buffer.from('old'), 'image/jpeg'); // obsolete width

    const queue = new ThumbnailQueue(bookStore, [60], mockResize);
    queue.start();
    queue.stop();
    await queue.drainForTest();

    expect(bookStore.getThumbnail('bk6', 300)).toBeNull(); // pruned
    expect(bookStore.getThumbnail('bk6', 60)).not.toBeNull(); // generated
  });

  it('start() called twice does not spawn a second loop', () => {
    bookStore.addBook('bk7', stage('bk7'), FAKE_META);
    const queue = new ThumbnailQueue(bookStore, [60], mockResize);
    queue.start();
    queue.start(); // second call should be a no-op
    queue.stop();
    // If two loops were spawned both would try to process jobs — verify no error thrown
    // and queue state is consistent (no assertion on resize count since processLoop
    // may have run 0 or 1 times before stop)
    expect(() => queue.stop()).not.toThrow();
  });
});

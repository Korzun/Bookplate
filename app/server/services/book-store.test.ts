import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import AdmZip from 'adm-zip';
import {
  BookStore,
  BookHashCollisionError,
  ScanImporter,
  SelfLinkError,
  DocumentAlreadyLinkedError,
  DocumentIsBookError,
} from './book-store';
import { partialMD5 } from './epub-parser';
import { EpubMeta, Owner, PageCursor } from '../types';
import { runMigrations } from '../db/migrate';

jest.mock('../logger');

const OWNER: Owner = { userId: 'usr_test000000000000000', username: 'alice' };

function makeMinimalEpub(title: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
  );
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata>
  <manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
  <spine toc="ncx"/>
</package>`)
  );
  return zip.toBuffer();
}

function makeMinimalEpubWithContent(bodyContent: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
  );
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title></metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/></spine>
</package>`)
  );
  zip.addFile('OEBPS/ch1.xhtml', Buffer.from(`<html><body>${bodyContent}</body></html>`));
  return zip.toBuffer();
}

function stage(id: string, content: string | Buffer = 'x'): string {
  const p = path.join(booksDir, `staged-${id}.epub`);
  fs.writeFileSync(p, content);
  return p;
}

// Direct SQL helpers scoped to OWNER, keeping the per-user table shape in mind.
async function insertHistory(
  oldId: string,
  currentId: string,
  opts: { timestamp?: number; type?: string } = {}
): Promise<void> {
  const ts = opts.timestamp ?? Date.now();
  if (opts.type !== undefined) {
    await prisma.$executeRaw`
      INSERT INTO book_id_history (user_id, old_id, current_id, timestamp, type)
      VALUES (${OWNER.userId}, ${oldId}, ${currentId}, ${ts}, ${opts.type})
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO book_id_history (user_id, old_id, current_id, timestamp)
      VALUES (${OWNER.userId}, ${oldId}, ${currentId}, ${ts})
    `;
  }
}

async function insertProgress(bookId: string, percentage: number): Promise<void> {
  await prisma.progress.create({
    data: {
      userId: OWNER.userId,
      document: bookId,
      progress: `epub:/${bookId}/${percentage}`,
      percentage,
      device: 'Kobo',
      deviceId: 'dev1',
      timestamp: Date.now(),
    },
  });
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
let bookStore: BookStore;
let dbPath: string;

beforeEach(async () => {
  booksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'books-test-'));
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

describe('addBook and listBooks', () => {
  it('inserts a book and lists it', async () => {
    await bookStore.addBook(OWNER, 'abc123', stage('abc123'), FAKE_META);
    const books = await bookStore.listBooks(OWNER);
    expect(books).toHaveLength(1);
    expect(books[0].id).toBe('abc123');
    expect(books[0].title).toBe('Test Book');
    expect(books[0].author).toBe('Author Name');
    expect(books[0].hasCover).toBe(true);
  });

  it('throws BookAlreadyExistsError when adding a book whose id is already in the DB', async () => {
    const aPath = path.join(booksDir, 'a.epub');
    const bPath = path.join(booksDir, 'b.epub');
    fs.writeFileSync(aPath, 'first');
    fs.writeFileSync(bPath, 'second');
    await bookStore.addBook(OWNER, 'same-id', aPath, FAKE_META);
    await expect(bookStore.addBook(OWNER, 'same-id', bPath, FAKE_META)).rejects.toThrow(
      'Book with id "same-id" already exists'
    );
  });

  it('lets two different owners each own a book with the same id', async () => {
    const other: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: other.userId, username: other.username } });
    fs.mkdirSync(path.join(booksRoot, other.username), { recursive: true });

    await bookStore.addBook(OWNER, 'shared-id', stage('alice-copy'), FAKE_META);
    // Same id under a different owner must not collide (composite PK is per-user).
    await expect(
      bookStore.addBook(other, 'shared-id', stage('bob-copy'), FAKE_META)
    ).resolves.toBeUndefined();

    expect((await bookStore.listBooks(OWNER)).map((b) => b.id)).toEqual(['shared-id']);
    expect((await bookStore.listBooks(other)).map((b) => b.id)).toEqual(['shared-id']);
    // Each copy lives in its own folder.
    expect(fs.existsSync(path.join(booksRoot, OWNER.username, 'shared-id.epub'))).toBe(true);
    expect(fs.existsSync(path.join(booksRoot, other.username, 'shared-id.epub'))).toBe(true);
  });

  it('moves the source file to <booksDir>/<id>.epub', async () => {
    const stagedPath = path.join(booksDir, 'staged.epub');
    fs.writeFileSync(stagedPath, 'content');
    await bookStore.addBook(OWNER, 'move-id', stagedPath, FAKE_META);
    expect(fs.existsSync(stagedPath)).toBe(false);
    expect(fs.existsSync(path.join(booksDir, 'move-id.epub'))).toBe(true);
  });

  it('is a no-op for the file when source is already at <id>.epub', async () => {
    const canonical = path.join(booksDir, 'noop-id.epub');
    fs.writeFileSync(canonical, 'content');
    await bookStore.addBook(OWNER, 'noop-id', canonical, FAKE_META);
    expect(fs.existsSync(canonical)).toBe(true);
    expect(fs.readFileSync(canonical, 'utf8')).toBe('content');
  });

  it('records size and mtime by stat-ing the source file', async () => {
    const stagedPath = path.join(booksDir, 'sized.epub');
    fs.writeFileSync(stagedPath, '0123456789');
    await bookStore.addBook(OWNER, 'size-id', stagedPath, FAKE_META);
    const book = await bookStore.getBookById(OWNER, 'size-id');
    expect(book!.size).toBe(10);
    expect(Math.abs(book!.mtime.getTime() - Date.now())).toBeLessThan(5000);
  });

  it('sorts by title', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), {
      ...FAKE_META,
      title: 'Zebra',
    });
    await bookStore.addBook(OWNER, 'id2', stage('id2'), {
      ...FAKE_META,
      title: 'Apple',
    });
    const books = await bookStore.listBooks(OWNER);
    expect(books[0].title).toBe('Apple');
    expect(books[1].title).toBe('Zebra');
  });

  it('returns hasCover false when no cover', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    const books = await bookStore.listBooks(OWNER);
    expect(books[0].hasCover).toBe(false);
  });

  it('persists titleSort on stored books', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      title: 'Foundation',
      author: 'Isaac Asimov',
      titleSort: 'Asimov, Isaac',
    };
    await bookStore.addBook(OWNER, 'id1', stage('id1'), meta);
    const book = await bookStore.getBookById(OWNER, 'id1');
    expect(book!.titleSort).toBe('Asimov, Isaac');
  });

  it('stores trimmed titleSort even when metadata has extra whitespace', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      titleSort: '  Asimov, Isaac  ',
    };
    await bookStore.addBook(OWNER, 'id2', stage('id2'), meta);
    const book = await bookStore.getBookById(OWNER, 'id2');
    expect(book!.titleSort).toBe('Asimov, Isaac');
  });

  it('sorts by titleSort before title', async () => {
    await bookStore.addBook(OWNER, 'id-a', stage('id-a'), {
      ...FAKE_META,
      title: 'Zzz',
      titleSort: 'Apple, A.',
    });
    await bookStore.addBook(OWNER, 'id-z', stage('id-z'), {
      ...FAKE_META,
      title: 'Aaa',
      titleSort: 'Zulu, Z.',
    });
    const books = await bookStore.listBooks(OWNER);
    expect(books[0].id).toBe('id-a');
    expect(books[1].id).toBe('id-z');
  });

  it('falls back to title when titleSort is empty', async () => {
    await bookStore.addBook(OWNER, 'id-b', stage('id-b'), {
      ...FAKE_META,
      title: 'Banana',
      titleSort: '',
    });
    await bookStore.addBook(OWNER, 'id-a', stage('id-a'), {
      ...FAKE_META,
      title: 'Apple',
      titleSort: '',
    });
    const books = await bookStore.listBooks(OWNER);
    expect(books[0].id).toBe('id-a');
    expect(books[1].id).toBe('id-b');
  });

  it('persists authorSort on stored books', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      author: 'Isaac Asimov',
      authorSort: 'Asimov, Isaac',
    };
    await bookStore.addBook(OWNER, 'id-as', stage('id-as'), meta);
    const book = await bookStore.getBookById(OWNER, 'id-as');
    expect(book!.authorSort).toBe('Asimov, Isaac');
  });

  it('persists publishDate on stored books', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      publishDate: '2001-01-16',
    };
    await bookStore.addBook(OWNER, 'id-pd', stage('id-pd'), meta);
    const book = await bookStore.getBookById(OWNER, 'id-pd');
    expect(book!.publishDate).toBe('2001-01-16');
  });

  it('stores and retrieves chapterNames (JSON round-trip)', async () => {
    await bookStore.addBook(OWNER, 'ch1', stage('ch1'), {
      ...FAKE_META,
      chapterCount: 2,
      chapterSpineMap: [1, 2],
      chapterNames: ['The Storm', 'The Calm'],
    });
    const book = await bookStore.getBookById(OWNER, 'ch1');
    expect(book?.chapterNames).toEqual(['The Storm', 'The Calm']);
  });

  it('returns empty chapterNames array when column is NULL (pre-migration books)', async () => {
    // Simulate a book inserted without chapter_names (NULL default)
    await prisma.$executeRawUnsafe(
      `INSERT INTO books (user_id, id, title, size, mtime, added_at, chapter_count, chapter_spine_map) VALUES ('${OWNER.userId}', 'old-book', 'Old Book', 100, 0, 0, 0, '[]')`
    );
    const book = await bookStore.getBookById(OWNER, 'old-book');
    expect(book?.chapterNames).toEqual([]);
  });

  it('exposes book.filename as the computed download name', async () => {
    await bookStore.addBook(OWNER, 'fname-1', stage('fname-1'), {
      ...FAKE_META,
      author: 'Frank Herbert',
      series: '',
      seriesIndex: 0,
      title: 'Dune',
    });
    const book = await bookStore.getBookById(OWNER, 'fname-1');
    expect(book!.filename).toBe('Frank_Herbert-Dune.epub');
  });

  it('exposes book.path as <booksDir>/<id>.epub regardless of stored path', async () => {
    await bookStore.addBook(OWNER, 'path-1', stage('path-1'), FAKE_META);
    const book = await bookStore.getBookById(OWNER, 'path-1');
    expect(book!.path).toBe(path.join(booksDir, 'path-1.epub'));
  });
});

describe('Series lifecycle — addBook', () => {
  it('creates a Series row when a book is added with a series name', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, series: 'Dune' });
    const row = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Dune' } },
    });
    expect(row).not.toBeNull();
    expect(row!.name).toBe('Dune');
    expect(row!.sortKey).toBe('Dune');
  });

  it('sets seriesId on the book to point at the Series row', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, series: 'Dune' });
    const book = await prisma.book.findUnique({
      where: { userId_id: { userId: OWNER.userId, id: 'b1' } },
      select: { seriesId: true },
    });
    const row = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Dune' } },
    });
    expect(book!.seriesId).toBe(row!.id);
  });

  it('does not create a Series row when series name is empty', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, series: '' });
    const count = await prisma.series.count({ where: { userId: OWNER.userId } });
    expect(count).toBe(0);
  });

  it('reuses the same Series row for two books in the same series', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, series: 'Dune' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, series: 'Dune' });
    const count = await prisma.series.count({
      where: { userId: OWNER.userId, name: 'Dune' },
    });
    expect(count).toBe(1);
  });
});

describe('Series lifecycle — reimportBook', () => {
  function makeImporterWithMeta(meta: Partial<EpubMeta>): ScanImporter {
    return {
      parseEpub: () => ({ ...FAKE_META, ...meta }),
      partialMD5: (fp) => crypto.createHash('md5').update(fp).digest('hex'),
    };
  }

  it('upserts a new Series when series name changes', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), { ...FAKE_META, series: 'Old' });
    const importer = makeImporterWithMeta({ series: 'New' });
    await bookStore.reimportBook(OWNER, 'id1', importer);
    const newRow = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'New' } },
    });
    expect(newRow).not.toBeNull();
  });

  it('deletes the old Series when series name changes and it has no other books', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), { ...FAKE_META, series: 'Old' });
    const importer = makeImporterWithMeta({ series: 'New' });
    await bookStore.reimportBook(OWNER, 'id1', importer);
    const oldRow = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Old' } },
    });
    expect(oldRow).toBeNull();
  });

  it('keeps the old Series when another book still belongs to it', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), { ...FAKE_META, series: 'Old' });
    await bookStore.addBook(OWNER, 'id2', stage('id2'), { ...FAKE_META, series: 'Old' });
    const importer = makeImporterWithMeta({ series: 'New' });
    await bookStore.reimportBook(OWNER, 'id1', importer);
    const oldRow = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Old' } },
    });
    expect(oldRow).not.toBeNull();
  });

  it('clears seriesId when series name becomes empty', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), { ...FAKE_META, series: 'Old' });
    // Use a fixed partialMD5 that returns the same id so the book row stays at 'id1'
    const importer: ScanImporter = {
      parseEpub: () => ({ ...FAKE_META, series: '' }),
      partialMD5: () => 'id1',
    };
    await bookStore.reimportBook(OWNER, 'id1', importer);
    const book = await prisma.book.findUnique({
      where: { userId_id: { userId: OWNER.userId, id: 'id1' } },
      select: { seriesId: true },
    });
    expect(book!.seriesId).toBeNull();
  });
});

describe('Series lifecycle — deleteBook', () => {
  it('deletes the Series row when the last book in the series is deleted', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, series: 'Dune' });
    await bookStore.deleteBook(OWNER, 'b1');
    const row = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Dune' } },
    });
    expect(row).toBeNull();
  });

  it('keeps the Series row when another book still belongs to it', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, series: 'Dune' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, series: 'Dune' });
    await bookStore.deleteBook(OWNER, 'b1');
    const row = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Dune' } },
    });
    expect(row).not.toBeNull();
  });
});

describe('getBookById', () => {
  it('returns the book by id', async () => {
    await bookStore.addBook(OWNER, 'myid', stage('myid'), FAKE_META);
    const book = await bookStore.getBookById(OWNER, 'myid');
    expect(book).not.toBeNull();
    expect(book!.filename).toBe('Author_Name-Test_Series-1-Test_Book.epub');
  });

  it('returns null for unknown id', async () => {
    expect(await bookStore.getBookById(OWNER, 'unknown')).toBeNull();
  });
});

describe('deleteBook', () => {
  it('removes book from db and returns it', async () => {
    await bookStore.addBook(OWNER, 'del1', stage('del1'), FAKE_META);
    const deleted = await bookStore.deleteBook(OWNER, 'del1');
    expect(deleted).not.toBeNull();
    expect(deleted!.id).toBe('del1');
    expect(await bookStore.listBooks(OWNER)).toHaveLength(0);
  });

  it('returns null for unknown id', async () => {
    expect(await bookStore.deleteBook(OWNER, 'nope')).toBeNull();
  });

  it('removes book_id_history entries for the deleted book', async () => {
    await bookStore.addBook(OWNER, 'del2', stage('del2'), FAKE_META);
    await insertHistory('old-del2', 'del2', { type: 'merge' });
    await bookStore.deleteBook(OWNER, 'del2');
    const rows = await prisma.$queryRaw<Array<unknown>>`
      SELECT * FROM book_id_history WHERE old_id = 'old-del2' OR current_id = 'del2'
    `;
    expect(rows).toHaveLength(0);
  });
});

describe('getCover', () => {
  it('returns cover data and mime', async () => {
    await bookStore.addBook(OWNER, 'cov1', stage('cov1'), FAKE_META);
    const cover = await bookStore.getCover(OWNER.userId, 'cov1');
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
    expect(await bookStore.getCover(OWNER.userId, 'nocov')).toBeNull();
  });

  it('returns null for unknown id', async () => {
    expect(await bookStore.getCover(OWNER.userId, 'unknown')).toBeNull();
  });
});

// ── scan() ───────────────────────────────────────────────────────────────────

function makeMockImporter(): ScanImporter {
  return {
    parseEpub: (_filePath: string): EpubMeta => ({
      title: 'Mock Title',
      author: 'Mock Author',
      description: '',
      publisher: '',
      series: '',
      seriesIndex: 0,
      titleSort: '',
      authorSort: '',
      publishDate: '',
      identifiers: [],
      subjects: [],
      coverData: null,
      coverMime: null,
      chapterCount: 0,
      chapterSpineMap: [],
      chapterNames: [],
      pageCount: 0,
    }),
    partialMD5: (filePath: string): string =>
      crypto.createHash('md5').update(filePath).digest('hex'),
  };
}

describe('BookStore.scan()', () => {
  it('returns empty lists when booksDir is empty and DB is empty', async () => {
    const result = await bookStore.scan(OWNER, makeMockImporter());
    expect(result).toEqual({ imported: [], removed: [] });
  });

  it('imports an epub found on disk but not in DB', async () => {
    const filePath = path.join(booksDir, 'new-book.epub');
    fs.writeFileSync(filePath, 'fake-epub-content');
    const result = await bookStore.scan(OWNER, makeMockImporter());
    expect(result.imported).toEqual(['new-book.epub']);
    expect(result.removed).toEqual([]);
    const books = await bookStore.listBooks(OWNER);
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe('Mock Title');
  });

  it('does not re-import a book already in the DB', async () => {
    const filePath = path.join(booksDir, 'existing.epub');
    fs.writeFileSync(filePath, 'fake-epub-content');
    await bookStore.scan(OWNER, makeMockImporter()); // first scan imports it
    const result = await bookStore.scan(OWNER, makeMockImporter()); // second scan is a no-op
    expect(result.imported).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(await bookStore.listBooks(OWNER)).toHaveLength(1);
  });

  it('removes a stale DB entry whose file no longer exists on disk', async () => {
    // Add the book with a real file, then delete the file to simulate a stale DB entry
    const ghostStagedPath = stage('ghostid001');
    await bookStore.addBook(OWNER, 'ghostid001', ghostStagedPath, {
      title: 'Ghost Book',
      author: '',
      description: '',
      publisher: '',
      series: '',
      seriesIndex: 0,
      titleSort: '',
      authorSort: '',
      publishDate: '',
      identifiers: [],
      subjects: [],
      coverData: null,
      coverMime: null,
      chapterCount: 0,
      chapterSpineMap: [],
      chapterNames: [],
      pageCount: 0,
    });
    // Delete the canonical file to make the DB entry stale
    fs.unlinkSync(path.join(booksDir, 'ghostid001.epub'));
    expect(await bookStore.listBooks(OWNER)).toHaveLength(1);
    const result = await bookStore.scan(OWNER, makeMockImporter());
    expect(result.removed).toEqual(['ghostid001.epub']);
    expect(result.imported).toEqual([]);
    expect(await bookStore.listBooks(OWNER)).toHaveLength(0);
  });

  it('skips a file that fails to parse and continues scanning others', async () => {
    fs.writeFileSync(path.join(booksDir, 'bad.epub'), 'bad');
    fs.writeFileSync(path.join(booksDir, 'good.epub'), 'good');
    const errorImporter: ScanImporter = {
      parseEpub: (filePath: string): EpubMeta => {
        if (filePath.includes('bad')) throw new Error('parse failed');
        return {
          title: 'Good',
          author: '',
          description: '',
          publisher: '',
          series: '',
          seriesIndex: 0,
          titleSort: '',
          authorSort: '',
          publishDate: '',
          identifiers: [],
          subjects: [],
          coverData: null,
          coverMime: null,
          chapterCount: 0,
          chapterSpineMap: [],
          chapterNames: [],
          pageCount: 0,
        };
      },
      partialMD5: (filePath: string): string =>
        crypto.createHash('md5').update(filePath).digest('hex'),
    };
    const result = await bookStore.scan(OWNER, errorImporter);
    expect(result.imported).toHaveLength(1);
    expect(result.imported).toContain('good.epub');
    expect(result.removed).toEqual([]);
  });

  it('ignores non-epub files in booksDir', async () => {
    fs.writeFileSync(path.join(booksDir, 'readme.txt'), 'text');
    fs.writeFileSync(path.join(booksDir, 'book.epub'), 'epub');
    const result = await bookStore.scan(OWNER, makeMockImporter());
    expect(result.imported).toEqual(['book.epub']);
  });

  it('renames a non-canonically-named file to <id>.epub before importing', async () => {
    const arbitraryPath = path.join(booksDir, 'arbitrary-name.epub');
    fs.writeFileSync(arbitraryPath, makeMinimalEpub('A Book'));
    const importer = makeMockImporter();
    const result = await bookStore.scan(OWNER, importer);
    expect(result.imported).toContain('arbitrary-name.epub');
    expect(fs.existsSync(arbitraryPath)).toBe(false);
    const books = await bookStore.listBooks(OWNER);
    expect(books).toHaveLength(1);
    const expectedPath = path.join(booksDir, books[0].id + '.epub');
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it('removes rows whose canonical file is missing', async () => {
    const id = 'orphan-id-123';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, makeMinimalEpub('To Delete'));
    await bookStore.addBook(OWNER, id, filePath, FAKE_META);
    fs.unlinkSync(filePath);

    const result = await bookStore.scan(OWNER, makeMockImporter());
    expect(result.removed).toContain(id + '.epub');
    expect(await bookStore.getBookById(OWNER, id)).toBeNull();
  });

  it('skips canonically-named files already in the DB without calling partialMD5', async () => {
    // Set up: a book exists at <id>.epub with id in DB.
    const id = 'a1b2c3d4e5f6789012345678901234ab';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, makeMinimalEpub('Already Here'));
    await bookStore.addBook(OWNER, id, filePath, FAKE_META);

    // Spy on importer.partialMD5 — it should NOT be called for this file.
    let mdCallCount = 0;
    const importer: ScanImporter = {
      parseEpub: () => {
        throw new Error('parseEpub should not be called');
      },
      partialMD5: () => {
        mdCallCount++;
        return 'should-not-happen';
      },
    };
    const result = await bookStore.scan(OWNER, importer);
    expect(result.imported).toEqual([]);
    expect(mdCallCount).toBe(0);
  });
});

describe('publisher, identifiers, subjects', () => {
  it('DB migration adds publisher, identifiers, subjects columns', async () => {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    const names = cols.map((c) => c.name);
    expect(names).toContain('publisher');
    expect(names).toContain('identifiers');
    expect(names).toContain('subjects');
  });

  it('stores and retrieves publisher', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), FAKE_META);
    const book = await bookStore.getBookById(OWNER, 'id1');
    expect(book?.publisher).toBe('Test Publisher');
  });

  it('stores and retrieves identifiers (JSON round-trip)', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), FAKE_META);
    const book = await bookStore.getBookById(OWNER, 'id1');
    expect(book?.identifiers).toEqual([{ scheme: 'ISBN', value: '978-0000000000' }]);
  });

  it('stores and retrieves subjects (JSON round-trip)', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), FAKE_META);
    const book = await bookStore.getBookById(OWNER, 'id1');
    expect(book?.subjects).toEqual(['Fiction']);
  });

  it('stores empty identifiers as empty array', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), {
      ...FAKE_META,
      identifiers: [],
    });
    const book = await bookStore.getBookById(OWNER, 'id1');
    expect(book?.identifiers).toEqual([]);
  });

  it('stores empty subjects as empty array', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), {
      ...FAKE_META,
      subjects: [],
    });
    const book = await bookStore.getBookById(OWNER, 'id1');
    expect(book?.subjects).toEqual([]);
  });
});

describe('chapter data', () => {
  it('DB migration adds chapter_count and chapter_spine_map columns', async () => {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    const names = cols.map((c) => c.name);
    expect(names).toContain('chapter_count');
    expect(names).toContain('chapter_spine_map');
  });

  it('stores and retrieves chapterCount', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), {
      ...FAKE_META,
      chapterCount: 12,
      chapterSpineMap: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
    const book = await bookStore.getBookById(OWNER, 'id1');
    expect(book?.chapterCount).toBe(12);
  });

  it('stores and retrieves chapterSpineMap (JSON round-trip)', async () => {
    const spineMap = [2, 4, 6, 8];
    await bookStore.addBook(OWNER, 'id2', stage('id2'), {
      ...FAKE_META,
      chapterCount: 4,
      chapterSpineMap: spineMap,
    });
    const book = await bookStore.getBookById(OWNER, 'id2');
    expect(book?.chapterSpineMap).toEqual(spineMap);
  });

  it('defaults to chapterCount 0 and empty chapterSpineMap', async () => {
    await bookStore.addBook(OWNER, 'id3', stage('id3'), FAKE_META);
    const book = await bookStore.getBookById(OWNER, 'id3');
    expect(book?.chapterCount).toBe(0);
    expect(book?.chapterSpineMap).toEqual([]);
  });
});

describe('page count data', () => {
  it('DB migration adds page_count column', async () => {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    expect(cols.map((c) => c.name)).toContain('page_count');
  });

  it('stores and retrieves pageCount', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), { ...FAKE_META, pageCount: 42 });
    expect((await bookStore.getBookById(OWNER, 'id1'))?.pageCount).toBe(42);
  });

  it('defaults to 0 when pageCount is not set', async () => {
    await bookStore.addBook(OWNER, 'id2', stage('id2'), { ...FAKE_META, pageCount: 0 });
    expect((await bookStore.getBookById(OWNER, 'id2'))?.pageCount).toBe(0);
  });
});

const BOOKS_SCHEMA = `
  CREATE TABLE books (
    id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, path TEXT NOT NULL,
    title TEXT NOT NULL, file_as TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '',
    series_index REAL NOT NULL DEFAULT 0, cover_data BLOB, cover_mime TEXT,
    size INTEGER NOT NULL, mtime INTEGER NOT NULL, added_at INTEGER NOT NULL
  )
`;

describe('migrations', () => {
  it('migration v2: recomputes stale book ID to match corrected partial MD5', async () => {
    const filePath = path.join(booksDir, 'migrate-v2.epub');
    fs.writeFileSync(filePath, Buffer.alloc(2048, 'x'));
    const correctId = partialMD5(filePath);
    const staleId = 'stale-id-from-old-algo';

    const migDbPath = path.join(
      os.tmpdir(),
      `migtest-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );
    const adapter = new PrismaBetterSqlite3({ url: `file:${migDbPath}` });
    const migPrisma = new PrismaClient({ adapter } as ConstructorParameters<
      typeof PrismaClient
    >[0]);
    await migPrisma.$executeRawUnsafe(BOOKS_SCHEMA);
    await migPrisma.$executeRawUnsafe(`
      CREATE TABLE users (username TEXT NOT NULL PRIMARY KEY, key TEXT NOT NULL)
    `);
    await migPrisma.$executeRaw`INSERT INTO users (username, key) VALUES ('alice', 'k')`;
    await migPrisma.$executeRaw`INSERT INTO books (id, filename, path, title, size, mtime, added_at) VALUES (${staleId}, 'migrate-v2.epub', ${filePath}, 'Test', 2048, 0, 0)`;

    await runMigrations(migPrisma, booksDir);

    // The book ID is recomputed by data_v2 (before per-user distribution), so the
    // single user's copy of the book carries the corrected id.
    const rows = await migPrisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM books`;
    expect(rows[0].id).toBe(correctId);

    await migPrisma.$disconnect();
    try {
      fs.unlinkSync(migDbPath);
    } catch {
      /* best-effort cleanup */
    }
  });

  it('migration v2: also updates matching progress records', async () => {
    const filePath = path.join(booksDir, 'migrate-v2-prog.epub');
    fs.writeFileSync(filePath, Buffer.alloc(2048, 'y'));
    const correctId = partialMD5(filePath);
    const staleId = 'stale-progress-id';

    const migDbPath = path.join(
      os.tmpdir(),
      `migtest-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );
    const adapter = new PrismaBetterSqlite3({ url: `file:${migDbPath}` });
    const migPrisma = new PrismaClient({ adapter } as ConstructorParameters<
      typeof PrismaClient
    >[0]);
    await migPrisma.$executeRawUnsafe(BOOKS_SCHEMA);
    await migPrisma.$executeRawUnsafe(`
      CREATE TABLE users (
        username TEXT NOT NULL PRIMARY KEY,
        key TEXT NOT NULL
      )
    `);
    await migPrisma.$executeRawUnsafe(`
      CREATE TABLE progress (
        username TEXT NOT NULL, document TEXT NOT NULL, progress TEXT NOT NULL,
        percentage REAL NOT NULL, device TEXT NOT NULL, device_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL, PRIMARY KEY (username, document)
      )
    `);
    await migPrisma.$executeRaw`INSERT INTO users (username, key) VALUES ('alice', 'k')`;
    await migPrisma.$executeRaw`INSERT INTO books (id, filename, path, title, size, mtime, added_at) VALUES (${staleId}, 'migrate-v2-prog.epub', ${filePath}, 'Test', 2048, 0, 0)`;
    await migPrisma.$executeRaw`INSERT INTO progress (username, document, progress, percentage, device, device_id, timestamp) VALUES ('alice', ${staleId}, 'epub://', 0.5, 'Kobo', 'dev1', 1000)`;

    await runMigrations(migPrisma, booksDir);

    const progRows = await migPrisma.$queryRaw<
      Array<{ document: string }>
    >`SELECT document FROM progress`;
    expect(progRows[0].document).toBe(correctId);

    await migPrisma.$disconnect();
    try {
      fs.unlinkSync(migDbPath);
    } catch {
      /* best-effort cleanup */
    }
  });

  it('data migration: assigns NanoID surrogate ids to users and preserves progress with working FK cascade', async () => {
    const migDbPath = path.join(
      os.tmpdir(),
      `migtest-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );
    const adapter = new PrismaBetterSqlite3({ url: `file:${migDbPath}` });
    const migPrisma = new PrismaClient({ adapter } as ConstructorParameters<
      typeof PrismaClient
    >[0]);
    await migPrisma.$executeRawUnsafe(BOOKS_SCHEMA);
    await migPrisma.$executeRawUnsafe(`
      CREATE TABLE "users" (
        "username" TEXT NOT NULL PRIMARY KEY,
        "key" TEXT NOT NULL
      )
    `);
    await migPrisma.$executeRawUnsafe(`
      CREATE TABLE "progress" (
        "username" TEXT NOT NULL,
        "document" TEXT NOT NULL,
        "progress" TEXT NOT NULL,
        "percentage" REAL NOT NULL,
        "device" TEXT NOT NULL,
        "device_id" TEXT NOT NULL,
        "timestamp" INTEGER NOT NULL,
        PRIMARY KEY ("username", "document"),
        CONSTRAINT "progress_username_fkey" FOREIGN KEY ("username") REFERENCES "users" ("username") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await migPrisma.$executeRaw`INSERT INTO users (username, key) VALUES ('alice', 'k')`;
    await migPrisma.$executeRaw`
      INSERT INTO progress (username, document, progress, percentage, device, device_id, timestamp)
      VALUES ('alice', 'doc-1', 'epub://', 0.5, 'Kobo', 'dev1', 1000)
    `;

    await runMigrations(migPrisma, booksDir);

    const users = await migPrisma.$queryRaw<Array<{ id: string; username: string }>>`
      SELECT id, username FROM users
    `;
    expect(users).toHaveLength(1);
    expect(users[0].id).toMatch(/^[A-Za-z0-9]{21}$/);

    const progressRows = await migPrisma.$queryRaw<
      Array<{ user_id: string; document: string; percentage: number }>
    >`SELECT user_id, document, percentage FROM progress`;
    expect(progressRows).toHaveLength(1);
    expect(progressRows[0].user_id).toBe(users[0].id);
    expect(progressRows[0].document).toBe('doc-1');
    expect(progressRows[0].percentage).toBe(0.5);

    // FK cascade still works post-migration: deleting the user removes their progress.
    await migPrisma.$executeRaw`DELETE FROM users WHERE id = ${users[0].id}`;
    const remaining = await migPrisma.$queryRaw<Array<{ document: string }>>`
      SELECT document FROM progress
    `;
    expect(remaining).toHaveLength(0);

    await migPrisma.$disconnect();
    try {
      fs.unlinkSync(migDbPath);
    } catch {
      /* best-effort cleanup */
    }
  });

  it('migration v2: skips books whose files are missing', async () => {
    const missingPath = path.join(booksDir, 'gone.epub');

    const migDbPath = path.join(
      os.tmpdir(),
      `migtest-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );
    const adapter = new PrismaBetterSqlite3({ url: `file:${migDbPath}` });
    const migPrisma = new PrismaClient({ adapter } as ConstructorParameters<
      typeof PrismaClient
    >[0]);
    await migPrisma.$executeRawUnsafe(BOOKS_SCHEMA);
    await migPrisma.$executeRawUnsafe(`
      CREATE TABLE users (username TEXT NOT NULL PRIMARY KEY, key TEXT NOT NULL)
    `);
    await migPrisma.$executeRaw`INSERT INTO users (username, key) VALUES ('alice', 'k')`;
    await migPrisma.$executeRaw`INSERT INTO books (id, filename, path, title, size, mtime, added_at) VALUES ('some-id', 'gone.epub', ${missingPath}, 'Gone', 100, 0, 0)`;

    // Should not throw; the book with the missing file keeps its old ID
    await runMigrations(migPrisma, booksDir);

    const rows = await migPrisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM books`;
    expect(rows[0].id).toBe('some-id');

    await migPrisma.$disconnect();
    try {
      fs.unlinkSync(migDbPath);
    } catch {
      /* best-effort cleanup */
    }
  });

  it('migration v5: adds chapter_names column with NULL default', async () => {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    const names = cols.map((c) => c.name);
    expect(names).toContain('chapter_names');
  });

  it('data migration: backfills page_count for books with zero page count', async () => {
    const migDbPath = path.join(
      os.tmpdir(),
      `migtest-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );
    const adapter = new PrismaBetterSqlite3({ url: `file:${migDbPath}` });
    const migPrisma = new PrismaClient({ adapter } as ConstructorParameters<
      typeof PrismaClient
    >[0]);
    // Full modern schema (matching 0_baseline) so applyPendingMigrations records
    // it as applied and the data_v8_page_count migration can run.
    await migPrisma.$executeRawUnsafe(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, file_as TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
        publisher TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0, identifiers TEXT NOT NULL DEFAULT '[]',
        subjects TEXT NOT NULL DEFAULT '[]', cover_data BLOB, cover_mime TEXT,
        size INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL DEFAULT 0, chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]', chapter_names TEXT,
        page_count INTEGER NOT NULL DEFAULT 0
      )
    `);

    await migPrisma.$executeRawUnsafe(`
      CREATE TABLE users (username TEXT NOT NULL PRIMARY KEY, key TEXT NOT NULL)
    `);
    await migPrisma.$executeRaw`INSERT INTO users (username, key) VALUES ('alice', 'k')`;

    const id = 'backfill-test';
    const epubPath = path.join(booksDir, `${id}.epub`);
    fs.writeFileSync(epubPath, makeMinimalEpubWithContent('A'.repeat(2048)));

    await migPrisma.$executeRaw`INSERT INTO books (id, title) VALUES (${id}, 'Test Book')`;

    await runMigrations(migPrisma, booksDir);

    const rows = await migPrisma.$queryRaw<
      Array<{ page_count: number }>
    >`SELECT page_count FROM books WHERE id = ${id}`;
    expect(rows[0].page_count).toBe(2);

    await migPrisma.$disconnect();
    try {
      fs.unlinkSync(migDbPath);
    } catch {
      /* best-effort cleanup */
    }
  });

  it('data migration: skips missing EPUB files and leaves page_count at 0', async () => {
    const migDbPath = path.join(
      os.tmpdir(),
      `migtest-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );
    const adapter = new PrismaBetterSqlite3({ url: `file:${migDbPath}` });
    const migPrisma = new PrismaClient({ adapter } as ConstructorParameters<
      typeof PrismaClient
    >[0]);
    await migPrisma.$executeRawUnsafe(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, file_as TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
        publisher TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0, identifiers TEXT NOT NULL DEFAULT '[]',
        subjects TEXT NOT NULL DEFAULT '[]', cover_data BLOB, cover_mime TEXT,
        size INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL DEFAULT 0, chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]', chapter_names TEXT,
        page_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    await migPrisma.$executeRawUnsafe(`
      CREATE TABLE users (username TEXT NOT NULL PRIMARY KEY, key TEXT NOT NULL)
    `);
    await migPrisma.$executeRaw`INSERT INTO users (username, key) VALUES ('alice', 'k')`;
    await migPrisma.$executeRaw`INSERT INTO books (id, title) VALUES ('missing-id', 'Gone')`;

    await expect(runMigrations(migPrisma, booksDir)).resolves.not.toThrow();

    const rows = await migPrisma.$queryRaw<
      Array<{ page_count: number }>
    >`SELECT page_count FROM books WHERE id = 'missing-id'`;
    expect(rows[0].page_count).toBe(0);

    await migPrisma.$disconnect();
    try {
      fs.unlinkSync(migDbPath);
    } catch {
      /* best-effort cleanup */
    }
  });

  it('data migration: does not overwrite existing non-zero page_count', async () => {
    const migDbPath = path.join(
      os.tmpdir(),
      `migtest-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );
    const adapter = new PrismaBetterSqlite3({ url: `file:${migDbPath}` });
    const migPrisma = new PrismaClient({ adapter } as ConstructorParameters<
      typeof PrismaClient
    >[0]);
    await migPrisma.$executeRawUnsafe(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', file_as TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
        publisher TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0, identifiers TEXT NOT NULL DEFAULT '[]',
        subjects TEXT NOT NULL DEFAULT '[]', cover_data BLOB, cover_mime TEXT,
        size INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL DEFAULT 0, chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]', chapter_names TEXT,
        page_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    await migPrisma.$executeRawUnsafe(`
      CREATE TABLE users (username TEXT NOT NULL PRIMARY KEY, key TEXT NOT NULL)
    `);
    await migPrisma.$executeRaw`INSERT INTO users (username, key) VALUES ('alice', 'k')`;
    await migPrisma.$executeRaw`INSERT INTO books (id, title, page_count) VALUES ('pinned-id', 'Test', 99)`;

    await runMigrations(migPrisma, booksDir);

    const rows = await migPrisma.$queryRaw<
      Array<{ page_count: number }>
    >`SELECT page_count FROM books WHERE id = 'pinned-id'`;
    expect(rows[0].page_count).toBe(99);

    await migPrisma.$disconnect();
    try {
      fs.unlinkSync(migDbPath);
    } catch {
      /* best-effort cleanup */
    }
  });
});

describe('reimportBook', () => {
  it('returns null for unknown book id', async () => {
    expect(await bookStore.reimportBook(OWNER, 'doesnotexist')).toBeNull();
  });

  it('re-reads metadata from disk and updates the DB row', async () => {
    const epubBuf = makeMinimalEpub('Original');
    const stagedPath = path.join(booksDir, 'staged-original.epub');
    fs.writeFileSync(stagedPath, epubBuf);
    const id = partialMD5(stagedPath);
    await bookStore.addBook(OWNER, id, stagedPath, {
      ...FAKE_META,
      title: 'Original',
    });

    // The file is now at <booksDir>/<id>.epub — overwrite it with new title
    const canonicalPath = path.join(booksDir, id + '.epub');
    const updatedBuf = makeMinimalEpub('Updated');
    fs.writeFileSync(canonicalPath, updatedBuf);

    const updated = await bookStore.reimportBook(OWNER, id);
    // ID may have changed due to ZIP rewrite — updated reflects new state
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('Updated');
  });

  it('deletes stale thumbnails when the cover changes on reimport', async () => {
    const stagedPath = path.join(booksDir, 'staged-cover-changed.epub');
    fs.writeFileSync(stagedPath, makeMinimalEpub('CoverChanged'));
    const id = partialMD5(stagedPath);
    await bookStore.addBook(OWNER, id, stagedPath, FAKE_META);
    await bookStore.saveThumbnail(OWNER.userId, id, 150, Buffer.from('thumb-old'), 'image/jpeg');
    expect(await bookStore.getThumbnail(OWNER.userId, id, 150)).not.toBeNull();

    const importer: ScanImporter = {
      parseEpub: () => ({ ...FAKE_META, coverData: Buffer.from('fake-cover-NEW') }),
      partialMD5: () => id,
    };
    await bookStore.reimportBook(OWNER, id, importer);

    expect(await bookStore.getThumbnail(OWNER.userId, id, 150)).toBeNull();
  });

  it('keeps thumbnails when the cover is unchanged on reimport', async () => {
    const stagedPath = path.join(booksDir, 'staged-cover-same.epub');
    fs.writeFileSync(stagedPath, makeMinimalEpub('CoverSame'));
    const id = partialMD5(stagedPath);
    await bookStore.addBook(OWNER, id, stagedPath, FAKE_META);
    await bookStore.saveThumbnail(OWNER.userId, id, 150, Buffer.from('thumb-keep'), 'image/jpeg');

    const importer: ScanImporter = {
      // Same cover bytes as FAKE_META, but a changed title to prove the reimport ran.
      parseEpub: () => ({ ...FAKE_META, title: 'Renamed' }),
      partialMD5: () => id,
    };
    await bookStore.reimportBook(OWNER, id, importer);

    const thumb = await bookStore.getThumbnail(OWNER.userId, id, 150);
    expect(thumb).not.toBeNull();
    expect(Buffer.from(thumb!.data).toString()).toBe('thumb-keep');
  });

  it('cascades id change to progress table when partial MD5 shifts', async () => {
    const epubBuf = makeMinimalEpub('Before');
    const stagedPath = path.join(booksDir, 'staged-cascade.epub');
    fs.writeFileSync(stagedPath, epubBuf);
    const oldId = partialMD5(stagedPath);
    await bookStore.addBook(OWNER, oldId, stagedPath, FAKE_META);
    const epubPath = path.join(booksDir, oldId + '.epub');

    // Insert a progress record for the old ID using the shared prisma client
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: oldId,
        progress: '/p[1]',
        percentage: 0.5,
        device: 'Kobo',
        deviceId: 'd1',
        timestamp: 1000,
      },
    });

    // Overwrite the file to force a different partial MD5
    const newBuf = makeMinimalEpub('After');
    fs.writeFileSync(epubPath, newBuf);

    const updated = await bookStore.reimportBook(OWNER, oldId);
    expect(updated).not.toBeNull();
    const newId = updated!.id;

    if (newId !== oldId) {
      // ID changed: old progress row should be gone, new one should exist
      const oldRows = await prisma.progress.findMany({ where: { document: oldId } });
      expect(oldRows).toHaveLength(0);
      const newRows = await prisma.progress.findMany({ where: { document: newId } });
      expect(newRows.length).toBeGreaterThan(0);
    }
    // If ID didn't change (unlikely but possible): still verify DB is consistent
    expect(await bookStore.getBookById(OWNER, newId)).not.toBeNull();
  });

  it('inherits orphaned progress under newId when no book owns that hash', async () => {
    const epubPath = path.join(booksDir, 'orphan.epub');
    const zip = new AdmZip();
    zip.addFile(
      'META-INF/container.xml',
      Buffer.from(
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
      )
    );
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(
        `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata><manifest/><spine/></package>`
      )
    );
    zip.writeZip(epubPath);

    const oldId = 'orphan-old';
    const newId = 'orphan-new';
    await bookStore.addBook(OWNER, oldId, epubPath, FAKE_META);

    // Orphaned progress under newId (no book owns newId)
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: newId,
        progress: '/p[2]',
        percentage: 0.8,
        device: 'Kobo',
        deviceId: 'd1',
        timestamp: 2000,
      },
    });

    const mockImporter = { parseEpub: () => FAKE_META, partialMD5: () => newId };
    const result = await bookStore.reimportBook(OWNER, oldId, mockImporter);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(newId);
    // Orphaned progress is now owned by the book
    const newRows = await prisma.progress.findMany({ where: { document: newId } });
    expect(newRows).toHaveLength(1);
    expect(newRows[0].userId).toBe(OWNER.userId);
    // Old id has no progress
    const oldRows = await prisma.progress.findMany({ where: { document: oldId } });
    expect(oldRows).toHaveLength(0);
  });

  it('keeps newer progress and discards older when both ids have records for the same user', async () => {
    const epubPath = path.join(booksDir, 'merge.epub');
    const zip = new AdmZip();
    zip.addFile(
      'META-INF/container.xml',
      Buffer.from(
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
      )
    );
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(
        `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata><manifest/><spine/></package>`
      )
    );
    zip.writeZip(epubPath);

    const oldId = 'merge-old';
    const newId = 'merge-new';
    await bookStore.addBook(OWNER, oldId, epubPath, FAKE_META);

    // OWNER (the book's owner): current progress is newer (ts=3000) than the
    // old-id record (ts=1000) → current wins. Reimport is owner-scoped, so only
    // OWNER's rows are touched.
    const bob = await prisma.user.create({ data: { id: 'bob-id', username: 'bob' } });
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: oldId,
        progress: '/p[5]',
        percentage: 0.9,
        device: 'Kobo',
        deviceId: 'd1',
        timestamp: 3000,
      },
    });
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: newId,
        progress: '/p[2]',
        percentage: 0.4,
        device: 'Kobo',
        deviceId: 'd1',
        timestamp: 1000,
      },
    });
    // bob does not own this book; his progress rows under the same ids must be
    // left untouched by OWNER's reimport.
    await prisma.progress.create({
      data: {
        userId: bob.id,
        document: oldId,
        progress: '/p[1]',
        percentage: 0.2,
        device: 'Kobo',
        deviceId: 'd2',
        timestamp: 2000,
      },
    });
    await prisma.progress.create({
      data: {
        userId: bob.id,
        document: newId,
        progress: '/p[9]',
        percentage: 0.95,
        device: 'Kobo',
        deviceId: 'd2',
        timestamp: 5000,
      },
    });

    const mockImporter = { parseEpub: () => FAKE_META, partialMD5: () => newId };
    await bookStore.reimportBook(OWNER, oldId, mockImporter);

    const ownerRows = await prisma.progress.findMany({
      where: { userId: OWNER.userId, document: newId },
    });
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0].progress).toBe('/p[5]'); // OWNER's newer current record won
    expect(ownerRows[0].timestamp).toBe(3000);

    // OWNER has no record left under oldId.
    const ownerOldCount = await prisma.progress.count({
      where: { userId: OWNER.userId, document: oldId },
    });
    expect(ownerOldCount).toBe(0);

    // bob's rows are completely untouched (reimport is owner-scoped).
    const bobOld = await prisma.progress.findUnique({
      where: { userId_document: { userId: bob.id, document: oldId } },
    });
    expect(bobOld!.progress).toBe('/p[1]');
    const bobNew = await prisma.progress.findUnique({
      where: { userId_document: { userId: bob.id, document: newId } },
    });
    expect(bobNew!.progress).toBe('/p[9]');
  });
});

describe('book_thumbnails', () => {
  it('saveThumbnail stores and getThumbnail retrieves', async () => {
    await bookStore.addBook(OWNER, 'bk1', stage('bk1'), FAKE_META);
    const data = Buffer.from('thumb-data');
    await bookStore.saveThumbnail(OWNER.userId, 'bk1', 150, data, 'image/jpeg');
    const result = await bookStore.getThumbnail(OWNER.userId, 'bk1', 150);
    expect(result).not.toBeNull();
    expect(Buffer.from(result!.data).toString()).toBe('thumb-data');
    expect(result!.mime).toBe('image/jpeg');
  });

  it('getThumbnail returns null when not present', async () => {
    await bookStore.addBook(OWNER, 'bk2', stage('bk2'), FAKE_META);
    expect(await bookStore.getThumbnail(OWNER.userId, 'bk2', 150)).toBeNull();
  });

  it('saveThumbnail upserts on (book_id, width) conflict', async () => {
    await bookStore.addBook(OWNER, 'bk3', stage('bk3'), FAKE_META);
    await bookStore.saveThumbnail(OWNER.userId, 'bk3', 150, Buffer.from('v1'), 'image/jpeg');
    await bookStore.saveThumbnail(OWNER.userId, 'bk3', 150, Buffer.from('v2'), 'image/jpeg');
    expect(
      Buffer.from((await bookStore.getThumbnail(OWNER.userId, 'bk3', 150))!.data).toString()
    ).toBe('v2');
  });

  it('pruneThumbnails removes rows whose width is not in the config list', async () => {
    await bookStore.addBook(OWNER, 'bk4', stage('bk4'), FAKE_META);
    await bookStore.saveThumbnail(OWNER.userId, 'bk4', 60, Buffer.from('x'), 'image/jpeg');
    await bookStore.saveThumbnail(OWNER.userId, 'bk4', 150, Buffer.from('y'), 'image/jpeg');
    await bookStore.saveThumbnail(OWNER.userId, 'bk4', 300, Buffer.from('z'), 'image/jpeg');
    const removed = await bookStore.pruneThumbnails([60, 150]);
    expect(removed).toBe(1);
    expect(await bookStore.getThumbnail(OWNER.userId, 'bk4', 60)).not.toBeNull();
    expect(await bookStore.getThumbnail(OWNER.userId, 'bk4', 150)).not.toBeNull();
    expect(await bookStore.getThumbnail(OWNER.userId, 'bk4', 300)).toBeNull();
  });

  it('pruneThumbnails with empty array removes all thumbnails', async () => {
    await bookStore.addBook(OWNER, 'bk5', stage('bk5'), FAKE_META);
    await bookStore.saveThumbnail(OWNER.userId, 'bk5', 60, Buffer.from('x'), 'image/jpeg');
    const removed = await bookStore.pruneThumbnails([]);
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
    await bookStore.saveThumbnail(OWNER.userId, 'bk6', 60, Buffer.from('x'), 'image/jpeg'); // already has 60px

    const missing = await bookStore.getMissingThumbnailPairs([60, 170]);
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
    const missing = await bookStore.getMissingThumbnailPairs([60]);
    expect(missing.map((p) => p.bookId)).not.toContain('bk8');
  });

  it('deleting a book cascades to book_thumbnails', async () => {
    await bookStore.addBook(OWNER, 'bk9', stage('bk9'), FAKE_META);
    await bookStore.saveThumbnail(OWNER.userId, 'bk9', 60, Buffer.from('x'), 'image/jpeg');
    await bookStore.deleteBook(OWNER, 'bk9');
    expect(await bookStore.getThumbnail(OWNER.userId, 'bk9', 60)).toBeNull();
  });

  it('reimportBook updates book_thumbnails book_id when id changes', async () => {
    // Create a fake epub file in the temp booksDir so reimportBook can read it
    const epubPath = path.join(booksDir, 'reimport.epub');
    const zip = new AdmZip();
    zip.addFile(
      'META-INF/container.xml',
      Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
    );
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Reimport Test</dc:title></metadata>
  <manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
  <spine toc="ncx"/>
</package>`)
    );
    zip.writeZip(epubPath);

    // Use a mock importer that returns a different ID on reimport
    const originalId = 'original-id';
    const newId = 'new-id';
    await bookStore.addBook(OWNER, originalId, epubPath, FAKE_META);
    await bookStore.saveThumbnail(OWNER.userId, originalId, 60, Buffer.from('thumb'), 'image/jpeg');

    const mockImporter = {
      parseEpub: () => FAKE_META,
      partialMD5: () => newId,
    };
    await bookStore.reimportBook(OWNER, originalId, mockImporter);

    // Thumbnail should now be under new ID (not lost, not causing FK error)
    expect(await bookStore.getThumbnail(OWNER.userId, newId, 60)).not.toBeNull();
    expect(await bookStore.getThumbnail(OWNER.userId, originalId, 60)).toBeNull();
  });

  it('renames file on disk from <oldId>.epub to <newId>.epub when hash changes', async () => {
    const oldId = 'old-id-aaaa';
    const oldPath = path.join(booksDir, oldId + '.epub');
    fs.writeFileSync(oldPath, 'epub-bytes');
    await bookStore.addBook(OWNER, oldId, oldPath, FAKE_META);

    const newId = 'new-id-bbbb';
    const mockImporter: ScanImporter = {
      parseEpub: () => ({ ...FAKE_META, title: 'New Title' }),
      partialMD5: () => newId,
    };
    await bookStore.reimportBook(OWNER, oldId, mockImporter);

    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(path.join(booksDir, newId + '.epub'))).toBe(true);
  });

  it('does not rename when hash is unchanged', async () => {
    const id = 'stable-id';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, 'epub-bytes');
    await bookStore.addBook(OWNER, id, filePath, FAKE_META);

    const mockImporter: ScanImporter = {
      parseEpub: () => ({ ...FAKE_META, title: 'Edited' }),
      partialMD5: () => id,
    };
    await bookStore.reimportBook(OWNER, id, mockImporter);

    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('throws BookHashCollisionError when new hash collides with another book', async () => {
    const epubPath = path.join(booksDir, 'collision.epub');
    const zip = new AdmZip();
    zip.addFile(
      'META-INF/container.xml',
      Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
    );
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Collision Test</dc:title></metadata>
  <manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
  <spine toc="ncx"/>
</package>`)
    );
    zip.writeZip(epubPath);

    const bookAId = 'book-a-id';
    const bookBId = 'book-b-id';
    await bookStore.addBook(OWNER, bookAId, epubPath, FAKE_META);
    await bookStore.addBook(OWNER, bookBId, stage('book-b-id'), FAKE_META);

    // Mock importer returns bookBId as the new hash — collision with existing book
    const mockImporter = {
      parseEpub: () => FAKE_META,
      partialMD5: () => bookBId,
    };

    await expect(bookStore.reimportBook(OWNER, bookAId, mockImporter)).rejects.toThrow(
      BookHashCollisionError
    );
    // Both books must remain intact after the failed reimport
    expect(await bookStore.getBookById(OWNER, bookAId)).not.toBeNull();
    expect(await bookStore.getBookById(OWNER, bookBId)).not.toBeNull();
  });
});

describe('book_id_history table', () => {
  it('creates the book_id_history table during migration', async () => {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM pragma_table_info('book_id_history')
    `;
    const names = cols.map((c) => c.name);
    expect(names).toContain('old_id');
    expect(names).toContain('current_id');
  });

  it('resolveBookId returns the input unchanged when no history exists', async () => {
    expect(await bookStore.resolveBookId(OWNER.userId, 'unknown-id')).toBe('unknown-id');
  });

  it('resolveBookId returns current_id when a mapping exists', async () => {
    await insertHistory('old-id', 'new-id', { type: 'merge' });
    expect(await bookStore.resolveBookId(OWNER.userId, 'old-id')).toBe('new-id');
  });

  it('resolveBookId is scoped to the owner — a mapping for another user is ignored', async () => {
    await prisma.user.create({ data: { id: 'usr_other00000000000000', username: 'bob' } });
    await prisma.$executeRaw`
      INSERT INTO book_id_history (user_id, old_id, current_id, timestamp, type)
      VALUES ('usr_other00000000000000', 'shared-old', 'bob-new', ${Date.now()}, 'merge')
    `;
    expect(await bookStore.resolveBookId(OWNER.userId, 'shared-old')).toBe('shared-old');
  });

  it('has a type column with default value edit', async () => {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM pragma_table_info('book_id_history')
    `;
    expect(cols.map((c) => c.name)).toContain('type');

    await insertHistory('type-test-old', 'type-test-new');
    const rows = await prisma.$queryRaw<Array<{ type: string }>>`
      SELECT type FROM book_id_history WHERE old_id = 'type-test-old'
    `;
    expect(rows[0].type).toBe('edit');
  });

  it('rejects invalid type values via CHECK constraint', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO book_id_history (user_id, old_id, current_id, timestamp, type)
        VALUES (${OWNER.userId}, 'check-old', 'check-new', ${Date.now()}, 'invalid')
      `
    ).rejects.toThrow();
  });
});

describe('resolveBookId — lineage via reimportBook', () => {
  function makeImporterWithId(newId: string): ScanImporter {
    return {
      parseEpub: (_filePath: string): EpubMeta => ({
        ...FAKE_META,
        title: 'Lineage Book',
      }),
      partialMD5: (_filePath: string): string => newId,
    };
  }

  it('single hop: resolveBookId(old) returns new after reimport changes ID', async () => {
    const stagedPath = stage('lineage-a');
    await bookStore.addBook(OWNER, 'id-a', stagedPath, FAKE_META);
    await bookStore.reimportBook(OWNER, 'id-a', makeImporterWithId('id-b'));
    expect(await bookStore.resolveBookId(OWNER.userId, 'id-a')).toBe('id-b');
  });

  it('multi-hop: resolveBookId(original) returns latest after two reimports', async () => {
    const stagedPath = stage('lineage-multi');
    await bookStore.addBook(OWNER, 'id-a', stagedPath, FAKE_META);
    // First hop: id-a → id-b
    await bookStore.reimportBook(OWNER, 'id-a', makeImporterWithId('id-b'));
    // Write a file at id-b so reimportBook can stat it
    fs.writeFileSync(path.join(booksDir, 'id-b.epub'), 'epub-content');
    // Second hop: id-b → id-c (also flattens id-a → id-c)
    await bookStore.reimportBook(OWNER, 'id-b', makeImporterWithId('id-c'));
    expect(await bookStore.resolveBookId(OWNER.userId, 'id-a')).toBe('id-c');
    expect(await bookStore.resolveBookId(OWNER.userId, 'id-b')).toBe('id-c');
  });

  it('no history entry when ID does not change on reimport', async () => {
    const stagedPath = stage('lineage-noop');
    await bookStore.addBook(OWNER, 'id-a', stagedPath, FAKE_META);
    await bookStore.reimportBook(OWNER, 'id-a', makeImporterWithId('id-a'));
    expect(await bookStore.resolveBookId(OWNER.userId, 'id-a')).toBe('id-a');
    const rows = await prisma.$queryRaw<Array<unknown>>`
      SELECT * FROM book_id_history WHERE old_id = 'id-a'
    `;
    expect(rows).toHaveLength(0);
  });

  describe('getBookLineage', () => {
    it('returns null for a book that does not exist', async () => {
      expect(await bookStore.getBookLineage(OWNER, 'no-such-id')).toBeNull();
    });

    it('returns currentId with empty entries for a book with no history', async () => {
      await bookStore.addBook(OWNER, 'id-a', stage('id-a'), FAKE_META);
      const result = await bookStore.getBookLineage(OWNER, 'id-a');
      expect(result).toEqual({ currentId: 'id-a', entries: [] });
    });

    it('returns one entry after a single reimport that changes the ID', async () => {
      const before = Date.now();
      await bookStore.addBook(OWNER, 'id-a', stage('id-a'), FAKE_META);
      const epubPath = path.join(booksDir, 'id-a.epub');
      fs.writeFileSync(epubPath, 'content-a');
      await bookStore.reimportBook(OWNER, 'id-a', makeImporterWithId('id-b'));
      const after = Date.now();

      const result = await bookStore.getBookLineage(OWNER, 'id-b');
      expect(result).not.toBeNull();
      expect(result!.currentId).toBe('id-b');
      expect(result!.entries).toHaveLength(1);
      expect(result!.entries[0].oldId).toBe('id-a');
      expect(result!.entries[0].newId).toBe('id-b');
      expect(result!.entries[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(result!.entries[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('entries are ordered newest-first', async () => {
      await bookStore.addBook(OWNER, 'id-a', stage('id-a'), FAKE_META);
      fs.writeFileSync(path.join(booksDir, 'id-a.epub'), 'content-a');
      await bookStore.reimportBook(OWNER, 'id-a', makeImporterWithId('id-b'));
      fs.writeFileSync(path.join(booksDir, 'id-b.epub'), 'content-b');
      await bookStore.reimportBook(OWNER, 'id-b', makeImporterWithId('id-c'));

      const result = await bookStore.getBookLineage(OWNER, 'id-c');
      expect(result!.entries).toHaveLength(2);
      expect(result!.entries[0].oldId).toBe('id-b');
      expect(result!.entries[0].newId).toBe('id-c');
      expect(result!.entries[1].oldId).toBe('id-a');
      expect(result!.entries[1].newId).toBe('id-b');
      expect(result!.entries[0].timestamp).toBeGreaterThanOrEqual(result!.entries[1].timestamp);
    });

    it('returns null when called with a stale (old) ID that has been reimported', async () => {
      await bookStore.addBook(OWNER, 'id-a', stage('id-a'), FAKE_META);
      fs.writeFileSync(path.join(booksDir, 'id-a.epub'), 'content-a');
      await bookStore.reimportBook(OWNER, 'id-a', makeImporterWithId('id-b'));

      // id-a is no longer a current book; getBookLineage should return null for it
      expect(await bookStore.getBookLineage(OWNER, 'id-a')).toBeNull();
      // id-b is the current book and should return normally
      expect(await bookStore.getBookLineage(OWNER, 'id-b')).not.toBeNull();
    });
  });
});

describe('getBookLineage returns type on entries', () => {
  function makeImporterWithId(newId: string): ScanImporter {
    return {
      parseEpub: (_filePath: string): EpubMeta => ({
        ...FAKE_META,
        title: 'Lineage Book',
      }),
      partialMD5: (_filePath: string): string => newId,
    };
  }

  it('returns type edit for reimport-created entries', async () => {
    await bookStore.addBook(OWNER, 'id-a', stage('id-a'), FAKE_META);
    fs.writeFileSync(path.join(booksDir, 'id-a.epub'), 'content');
    await bookStore.reimportBook(OWNER, 'id-a', makeImporterWithId('id-b'));

    const result = await bookStore.getBookLineage(OWNER, 'id-b');
    expect(result!.entries[0].type).toBe('edit');
  });
});

describe('linkDocument', () => {
  it('returns null when target book does not exist', async () => {
    const result = await bookStore.linkDocument(OWNER, 'no-such-book', 'orphan-1');
    expect(result).toBeNull();
  });

  it('throws SelfLinkError when documentId equals bookId', async () => {
    await bookStore.addBook(OWNER, 'self-link', stage('self-link'), FAKE_META);
    await expect(bookStore.linkDocument(OWNER, 'self-link', 'self-link')).rejects.toThrow(
      SelfLinkError
    );
  });

  it('throws DocumentAlreadyLinkedError when documentId is already linked', async () => {
    await bookStore.addBook(OWNER, 'target', stage('target'), FAKE_META);
    await insertHistory('already-linked', 'target', { type: 'merge' });
    await expect(bookStore.linkDocument(OWNER, 'target', 'already-linked')).rejects.toThrow(
      DocumentAlreadyLinkedError
    );
  });

  it('inserts a merge entry and migrates progress', async () => {
    await bookStore.addBook(OWNER, 'link-target', stage('link-target'), FAKE_META);
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: 'orphan-doc',
        progress: '',
        percentage: 0.5,
        device: 'Kobo',
        deviceId: 'dev-1',
        timestamp: 1000,
      },
    });

    const result = await bookStore.linkDocument(OWNER, 'link-target', 'orphan-doc');
    expect(result).toBe(true);

    const rows = await prisma.$queryRaw<Array<{ type: string }>>`
      SELECT type FROM book_id_history WHERE old_id = 'orphan-doc' AND current_id = 'link-target'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('merge');

    const targetProgress = await prisma.progress.findUnique({
      where: { userId_document: { userId: OWNER.userId, document: 'link-target' } },
    });
    expect(targetProgress).not.toBeNull();
    expect(targetProgress!.percentage).toBe(0.5);

    const orphanProgress = await prisma.progress.findUnique({
      where: { userId_document: { userId: OWNER.userId, document: 'orphan-doc' } },
    });
    expect(orphanProgress).toBeNull();
  });

  it('keeps newer progress when both orphan and target have records (newer-wins)', async () => {
    await bookStore.addBook(OWNER, 'nw-target', stage('nw-target'), FAKE_META);
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: 'nw-orphan',
        progress: '',
        percentage: 0.3,
        device: 'Kobo',
        deviceId: 'dev-2',
        timestamp: 100,
      },
    });
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: 'nw-target',
        progress: '',
        percentage: 0.8,
        device: 'Web',
        deviceId: 'dev-3',
        timestamp: 200,
      },
    });

    await bookStore.linkDocument(OWNER, 'nw-target', 'nw-orphan');

    const targetProgress = await prisma.progress.findUnique({
      where: { userId_document: { userId: OWNER.userId, document: 'nw-target' } },
    });
    expect(targetProgress!.percentage).toBe(0.8);
  });

  it('orphan progress wins when it is newer', async () => {
    await bookStore.addBook(OWNER, 'ow-target', stage('ow-target'), FAKE_META);
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: 'ow-orphan',
        progress: '',
        percentage: 0.9,
        device: 'Kobo',
        deviceId: 'dev-4',
        timestamp: 300,
      },
    });
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: 'ow-target',
        progress: '',
        percentage: 0.1,
        device: 'Web',
        deviceId: 'dev-5',
        timestamp: 100,
      },
    });

    await bookStore.linkDocument(OWNER, 'ow-target', 'ow-orphan');

    const targetProgress = await prisma.progress.findUnique({
      where: { userId_document: { userId: OWNER.userId, document: 'ow-target' } },
    });
    expect(targetProgress!.percentage).toBe(0.9);
  });

  it('throws DocumentIsBookError when documentId is an existing book', async () => {
    await bookStore.addBook(OWNER, 'doc-is-book-target', stage('doc-is-book-target'), FAKE_META);
    await bookStore.addBook(OWNER, 'doc-is-book-doc', stage('doc-is-book-doc'), FAKE_META);
    await expect(
      bookStore.linkDocument(OWNER, 'doc-is-book-target', 'doc-is-book-doc')
    ).rejects.toThrow(DocumentIsBookError);
  });
});

describe('unlinkDocument', () => {
  it('returns not_found when no matching row exists', async () => {
    const result = await bookStore.unlinkDocument(OWNER, 'no-book', 'no-doc');
    expect(result).toBe('not_found');
  });

  it('returns edit_row when the row has type=edit', async () => {
    await bookStore.addBook(OWNER, 'ul-target', stage('ul-target'), FAKE_META);
    await insertHistory('ul-edit-doc', 'ul-target', { type: 'edit' });
    const result = await bookStore.unlinkDocument(OWNER, 'ul-target', 'ul-edit-doc');
    expect(result).toBe('edit_row');
  });

  it('deletes the merge row and returns deleted', async () => {
    await bookStore.addBook(OWNER, 'ul-target2', stage('ul-target2'), FAKE_META);
    await insertHistory('ul-merge-doc', 'ul-target2', { type: 'merge' });
    const result = await bookStore.unlinkDocument(OWNER, 'ul-target2', 'ul-merge-doc');
    expect(result).toBe('deleted');

    const rows = await prisma.$queryRaw<Array<unknown>>`
      SELECT * FROM book_id_history WHERE old_id = 'ul-merge-doc'
    `;
    expect(rows).toHaveLength(0);
  });

  it('leaves progress records untouched when unlinking', async () => {
    await bookStore.addBook(OWNER, 'ul-prog-target', stage('ul-prog-target'), FAKE_META);
    await insertHistory('ul-prog-orphan', 'ul-prog-target', { type: 'merge' });
    await prisma.progress.create({
      data: {
        userId: OWNER.userId,
        document: 'ul-prog-target',
        progress: '',
        percentage: 0.6,
        device: 'Kobo',
        deviceId: 'dev-6',
        timestamp: 500,
      },
    });

    await bookStore.unlinkDocument(OWNER, 'ul-prog-target', 'ul-prog-orphan');

    const progress = await prisma.progress.findUnique({
      where: { userId_document: { userId: OWNER.userId, document: 'ul-prog-target' } },
    });
    expect(progress).not.toBeNull();
    expect(progress!.percentage).toBe(0.6);
  });
});

describe('BookStore.listBooksPage()', () => {
  it('returns empty result for an empty library', async () => {
    const result = await bookStore.listBooksPage(OWNER, null, 20);
    expect(result).toEqual({ items: [], books: [], nextCursor: null });
  });

  it('returns standalone books as display units', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Alpha', series: '' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'Beta', series: '' });
    const result = await bookStore.listBooksPage(OWNER, null, 20);
    expect(result.items).toEqual([
      { type: 'standalone', bookId: 'b1' },
      { type: 'standalone', bookId: 'b2' },
    ]);
    expect(result.books).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('returns a series as a single display unit', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20);
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    expect(result.books).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('includes all series books in the books array even when only one item is a series', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'D1',
      series: 'Dune',
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'D2',
      series: 'Dune',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20);
    const ids = result.books.map((b) => b.id).sort();
    expect(ids).toEqual(['b1', 'b2'].sort());
  });

  it('merges series and standalones in title/name order', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Apple', series: '' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Cherry',
      series: 'Banana',
    });
    await bookStore.addBook(OWNER, 'b3', stage('b3'), { ...FAKE_META, title: 'Dates', series: '' });
    const result = await bookStore.listBooksPage(OWNER, null, 20);
    expect(result.items).toEqual([
      { type: 'standalone', bookId: 'b1' },
      { type: 'series', seriesName: 'Banana' },
      { type: 'standalone', bookId: 'b3' },
    ]);
  });

  it('returns nextCursor when take is less than total display units', async () => {
    for (let i = 1; i <= 5; i++) {
      await bookStore.addBook(OWNER, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Book ${String.fromCharCode(64 + i)}`,
        series: '',
      });
    }
    const result = await bookStore.listBooksPage(OWNER, null, 3);
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).not.toBeNull();
  });

  it('advances the cursor to load the next page', async () => {
    for (let i = 1; i <= 4; i++) {
      await bookStore.addBook(OWNER, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Book ${String.fromCharCode(64 + i)}`,
        series: '',
      });
    }
    const page1 = await bookStore.listBooksPage(OWNER, null, 2);
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const cursor = JSON.parse(
      Buffer.from(page1.nextCursor!, 'base64').toString('utf-8')
    ) as PageCursor;
    const page2 = await bookStore.listBooksPage(OWNER, cursor, 2);
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    const allIds = [...page1.items, ...page2.items].map((item) =>
      item.type === 'standalone' ? item.bookId : item.seriesName
    );
    expect(new Set(allIds).size).toBe(4);
  });

  it('does not skip standalones with duplicate titles at a page boundary', async () => {
    // b1 and b2 share the same title; b3 is distinct. With take=1, the cursor
    // after b1 must land correctly on b2 rather than skipping to b3.
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, title: 'Same', series: '' });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), { ...FAKE_META, title: 'Same', series: '' });
    await bookStore.addBook(OWNER, 'b3', stage('b3'), { ...FAKE_META, title: 'Zzz', series: '' });

    const page1 = await bookStore.listBooksPage(OWNER, null, 1);
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();

    const c1 = JSON.parse(Buffer.from(page1.nextCursor!, 'base64').toString('utf-8')) as PageCursor;
    const page2 = await bookStore.listBooksPage(OWNER, c1, 1);
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).not.toBeNull();

    const c2 = JSON.parse(Buffer.from(page2.nextCursor!, 'base64').toString('utf-8')) as PageCursor;
    const page3 = await bookStore.listBooksPage(OWNER, c2, 1);
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    const allIds = [page1, page2, page3].flatMap((p) =>
      p.items.map((item) => (item.type === 'standalone' ? item.bookId : item.seriesName))
    );
    expect(new Set(allIds).size).toBe(3); // all 3 books returned, none skipped
    expect(allIds).toContain('b1');
    expect(allIds).toContain('b2');
    expect(allIds).toContain('b3');
  });
});

describe('getSubjects', () => {
  it('returns sorted unique subjects across all books', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      subjects: ['Fiction', 'History'],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      subjects: ['Fiction', 'Science'],
    });
    const subjects = await bookStore.getSubjects(OWNER);
    expect(subjects).toEqual(['Fiction', 'History', 'Science']);
  });

  it('returns empty array when no books have subjects', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, subjects: [] });
    const subjects = await bookStore.getSubjects(OWNER);
    expect(subjects).toEqual([]);
  });

  it('excludes non-string and blank subjects from mixed-type JSON', async () => {
    await prisma.$executeRaw`
      INSERT INTO books (user_id, id, title, subjects, size, mtime, added_at)
      VALUES (${OWNER.userId}, 'mixed-types', 'Mixed', '["Valid", 42, true, null, "  ", "Also Valid"]', 1, 1, 1)
    `;
    const subjects = await bookStore.getSubjects(OWNER);
    expect(subjects).toEqual(['Also Valid', 'Valid']);
  });

  it('only returns subjects belonging to the given owner', async () => {
    const OTHER_ID = 'usr_other00000000000000000';
    await prisma.user.create({ data: { id: OTHER_ID, username: 'bob' } });
    const otherOwner = { userId: OTHER_ID, username: 'bob' };
    const otherDir = path.join(booksRoot, 'bob');
    fs.mkdirSync(otherDir, { recursive: true });
    const bobBook = path.join(otherDir, 'staged-b2.epub');
    fs.writeFileSync(bobBook, 'x');
    await bookStore.addBook(OWNER, 'a1', stage('a1'), {
      ...FAKE_META,
      subjects: ['AliceOnly'],
    });
    await bookStore.addBook(otherOwner, 'b2', bobBook, {
      ...FAKE_META,
      subjects: ['BobOnly'],
    });
    const subjects = await bookStore.getSubjects(OWNER);
    expect(subjects).toEqual(['AliceOnly']);
    expect(subjects).not.toContain('BobOnly');
  });
});

describe('getSearchSuggestions', () => {
  it('returns matching authors', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Piranesi',
      author: 'Susanna Clarke',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'jemi', filter: {} });
    const authors = result.groups.find((g) => g.type === 'author');
    expect(authors?.items).toEqual([
      { label: 'N.K. Jemisin', value: 'N.K. Jemisin', matchStart: 5, matchLength: 4 },
    ]);
  });

  it('returns matching series', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: 'Broken Earth',
      seriesIndex: 1,
      subjects: [],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'broken', filter: {} });
    const series = result.groups.find((g) => g.type === 'series');
    expect(series?.items).toEqual([
      { label: 'Broken Earth', value: 'Broken Earth', matchStart: 0, matchLength: 6 },
    ]);
  });

  it('returns matching book titles', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'fifth', filter: {} });
    const books = result.groups.find((g) => g.type === 'book');
    expect(books?.items).toEqual([
      { label: 'The Fifth Season', value: 'b1', matchStart: 4, matchLength: 5 },
    ]);
  });

  it('returns matching subjects', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Foo',
      author: 'Author',
      series: '',
      seriesIndex: 0,
      subjects: ['Fantasy', 'Science Fiction'],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'fan', filter: {} });
    const subjects = result.groups.find((g) => g.type === 'subject');
    expect(subjects?.items).toEqual([
      { label: 'Fantasy', value: 'Fantasy', matchStart: 0, matchLength: 3 },
    ]);
  });

  it('excludes active subject chips from subject group', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Foo',
      author: 'Author',
      series: '',
      seriesIndex: 0,
      subjects: ['Fantasy', 'Fantastic Voyage'],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, {
      q: 'fan',
      filter: { activeSubjects: ['Fantasy'] },
    });
    const subjects = result.groups.find((g) => g.type === 'subject');
    expect(subjects?.items.map((i) => i.value)).toEqual(['Fantastic Voyage']);
  });

  it('omits author group when filter.author is set', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Foo',
      author: 'N.K. Jemisin',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, {
      q: 'jemi',
      filter: { author: 'N.K. Jemisin' },
    });
    expect(result.groups.find((g) => g.type === 'author')).toBeUndefined();
  });

  it('omits series group when filter.seriesName is set', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Foo',
      author: 'Author',
      series: 'Broken Earth',
      seriesIndex: 1,
      subjects: [],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, {
      q: 'broken',
      filter: { seriesName: 'Broken Earth' },
    });
    expect(result.groups.find((g) => g.type === 'series')).toBeUndefined();
  });

  it('constrains series to active author filter', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: 'Broken Earth',
      seriesIndex: 1,
      subjects: [],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Piranesi',
      author: 'Susanna Clarke',
      series: 'Broken Earth Fake',
      seriesIndex: 1,
      subjects: [],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, {
      q: 'broken',
      filter: { author: 'N.K. Jemisin' },
    });
    const series = result.groups.find((g) => g.type === 'series');
    expect(series?.items.map((i) => i.value)).toEqual(['Broken Earth']);
  });

  it('caps each group at 5 items', async () => {
    for (let i = 0; i < 7; i++) {
      await bookStore.addBook(OWNER, `b${i}`, stage(`b${i}`), {
        ...FAKE_META,
        title: `Alpha Book ${i}`,
        author: `Author${i}`,
        series: '',
        seriesIndex: 0,
        subjects: [],
      });
    }
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'alpha', filter: {} });
    const books = result.groups.find((g) => g.type === 'book');
    expect(books?.items.length).toBeLessThanOrEqual(5);
  });

  it('returns empty groups for query that matches nothing', async () => {
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'zzznomatch', filter: {} });
    expect(result.groups).toEqual([]);
  });

  it('returns author matching initials abbreviation (NK J → N.K. Jemisin)', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      author: 'N.K. Jemisin',
      series: '',
      seriesIndex: 0,
      subjects: [],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'NK J', filter: {} });
    const authors = result.groups.find((g) => g.type === 'author');
    expect(authors?.items.map((i) => i.value)).toContain('N.K. Jemisin');
  });

  it('returns series matching single-char omission typo (Texcalaan → Teixcalaan)', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'A Memory Called Empire',
      author: 'Arkady Martine',
      series: 'Teixcalaan',
      seriesIndex: 1,
      subjects: [],
    });
    const result = await bookStore.getSearchSuggestions(OWNER, { q: 'Texcalaan', filter: {} });
    const series = result.groups.find((g) => g.type === 'series');
    expect(series?.items.map((i) => i.value)).toContain('Teixcalaan');
  });
});

describe('listBooksPage with filters', () => {
  it('status=not-started returns standalone books with no progress', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
    });
    await insertProgress('b1', 0.5);
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'not-started' });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b2' }]);
  });

  it('status=in-progress returns standalone books with partial progress', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b3', stage('b3'), {
      ...FAKE_META,
      title: 'Gamma',
      series: '',
      seriesIndex: 0,
    });
    await insertProgress('b1', 0.5);
    await insertProgress('b2', 1.0);
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'in-progress' });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('status=completed returns standalone books with percentage >= 1', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
    });
    await insertProgress('b1', 1.0);
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'completed' });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('status=not-started returns series where no member book has progress', async () => {
    await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await bookStore.addBook(OWNER, 's2b1', stage('s2b1'), {
      ...FAKE_META,
      title: 'Foundation 1',
      series: 'Foundation',
      seriesIndex: 1,
    });
    await insertProgress('s1b1', 0.5);
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'not-started' });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Foundation' }]);
  });

  it('status=completed returns series where all member books have percentage >= 1', async () => {
    await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await bookStore.addBook(OWNER, 's1b2', stage('s1b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
      seriesIndex: 2,
    });
    await bookStore.addBook(OWNER, 's2b1', stage('s2b1'), {
      ...FAKE_META,
      title: 'Foundation 1',
      series: 'Foundation',
      seriesIndex: 1,
    });
    await insertProgress('s1b1', 1.0);
    await insertProgress('s1b2', 1.0);
    await insertProgress('s2b1', 0.5);
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'completed' });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('status=in-progress returns series with a book actively being read', async () => {
    await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await bookStore.addBook(OWNER, 's1b2', stage('s1b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
      seriesIndex: 2,
    });
    await bookStore.addBook(OWNER, 's1b3', stage('s1b3'), {
      ...FAKE_META,
      title: 'Dune 3',
      series: 'Dune',
      seriesIndex: 3,
    });
    await insertProgress('s1b1', 1.0);
    await insertProgress('s1b2', 0.4);
    // s1b3 has no progress
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'in-progress' });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('status=in-progress excludes series with only completed and unread books', async () => {
    await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await bookStore.addBook(OWNER, 's1b2', stage('s1b2'), {
      ...FAKE_META,
      title: 'Dune 2',
      series: 'Dune',
      seriesIndex: 2,
    });
    await insertProgress('s1b1', 1.0);
    // s1b2 has no progress — finished book 1 but haven't started book 2
    const result = await bookStore.listBooksPage(OWNER, null, 20, { status: 'in-progress' });
    expect(result.items).toEqual([]);
  });

  it('seriesName + status combined: shows only the named series when completed', async () => {
    await bookStore.addBook(OWNER, 'sa1', stage('sa1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    await insertProgress('sa1', 1.0);
    await insertProgress('s1b1', 1.0);
    const result = await bookStore.listBooksPage(OWNER, null, 20, {
      seriesName: 'Dune',
      status: 'completed',
    });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('no filters returns same result as calling without filters arg', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    const withoutFilters = await bookStore.listBooksPage(OWNER, null, 20);
    const withEmptyFilters = await bookStore.listBooksPage(OWNER, null, 20, {});
    expect(withEmptyFilters.items).toEqual(withoutFilters.items);
  });

  it('subjects filter returns only standalone books with that subject', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
      subjects: ['Fantasy'],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
      subjects: ['Science Fiction'],
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { subjects: ['Fantasy'] });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('subjects filter does not match partial subject names', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
      subjects: ['Science'],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
      subjects: ['Science Fiction'],
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { subjects: ['Science'] });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('subjects filter handles subjects containing quote characters', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
      subjects: ['He said "Hi"'],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Beta',
      series: '',
      seriesIndex: 0,
      subjects: ['Fantasy'],
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { subjects: ['He said "Hi"'] });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('subjects filter returns series whose subject roll-up contains the subject', async () => {
    await bookStore.addBook(OWNER, 's1b1', stage('s1b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
      subjects: ['Science Fiction'],
    });
    await bookStore.addBook(OWNER, 's2b1', stage('s2b1'), {
      ...FAKE_META,
      title: 'Fellowship 1',
      series: 'Fellowship',
      seriesIndex: 1,
      subjects: ['Fantasy'],
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, {
      subjects: ['Science Fiction'],
    });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('entryType=series returns only series display units', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { entryType: 'series' });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
    expect(result.books).toHaveLength(1);
    expect(result.books[0].id).toBe('b2');
  });

  it('entryType=standalone returns only standalone display units', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { entryType: 'standalone' });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
    expect(result.books).toHaveLength(1);
    expect(result.books[0].id).toBe('b1');
  });

  it('no entryType filter returns both series and standalone display units', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Alpha',
      series: '',
      seriesIndex: 0,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      seriesIndex: 1,
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, {});
    expect(result.items).toHaveLength(2);
    expect(result.items).toEqual(
      expect.arrayContaining([
        { type: 'series', seriesName: 'Dune' },
        { type: 'standalone', bookId: 'b1' },
      ])
    );
  });
});

describe('series aggregate metadata', () => {
  it('sets bookCount, author, publisher, totalPages, subjects after addBook', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'Dune',
      subjects: ['Science Fiction', 'Space Opera'],
      author: 'Frank Herbert',
      publisher: 'Chilton Books',
      pageCount: 412,
    });

    const series = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'Dune' } });
    expect(series).not.toBeNull();
    expect(series!.bookCount).toBe(1);
    expect(series!.author).toBe('Frank Herbert');
    expect(series!.publisher).toBe('Chilton Books');
    expect(series!.totalPages).toBe(412);
    expect(JSON.parse(series!.subjects)).toEqual(['Science Fiction', 'Space Opera']);
  });

  it('deduplicates subjects case-insensitively across books and sorts them', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'Dune',
      subjects: ['Science Fiction', 'Epic'],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      series: 'Dune',
      seriesIndex: 2,
      subjects: ['science fiction', 'Adventure'],
    });

    const series = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'Dune' } });
    // 'science fiction' deduped with 'Science Fiction' (first-seen wins); sorted alphabetically
    expect(JSON.parse(series!.subjects)).toEqual(['Adventure', 'Epic', 'Science Fiction']);
    expect(series!.bookCount).toBe(2);
  });

  it('deduplicates authors and publishers case-insensitively, joins with ", "', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'Shared',
      author: 'Alice Writer',
      publisher: 'Big Press',
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      series: 'Shared',
      seriesIndex: 2,
      author: 'alice writer',
      publisher: 'Small Press',
    });

    const series = await prisma.series.findFirst({
      where: { userId: OWNER.userId, name: 'Shared' },
    });
    expect(series!.author).toBe('Alice Writer'); // case-insensitive dedup, first wins
    expect(series!.publisher).toBe('Big Press, Small Press');
  });

  it('accumulates totalPages across books', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'S',
      pageCount: 100,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      series: 'S',
      seriesIndex: 2,
      pageCount: 200,
    });

    const series = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'S' } });
    expect(series!.totalPages).toBe(300);
  });

  it('updates series meta after reimportBook changes subjects', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'Dune',
      subjects: ['Science Fiction'],
      pageCount: 100,
    });

    const epub = makeMinimalEpub('Dune Messiah');
    const newPath = path.join(booksDir, 'b1.epub');
    fs.writeFileSync(newPath, epub);

    const mockImporter: ScanImporter = {
      parseEpub: () => ({
        ...FAKE_META,
        title: 'Dune Messiah',
        series: 'Dune',
        subjects: ['Science Fiction', 'Politics'],
        pageCount: 200,
      }),
      partialMD5: () => 'b1',
    };

    await bookStore.reimportBook(OWNER, 'b1', mockImporter);

    const series = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'Dune' } });
    expect(JSON.parse(series!.subjects)).toEqual(['Politics', 'Science Fiction']);
    expect(series!.totalPages).toBe(200);
  });

  it('updates both old and new series when reimportBook changes series membership', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'Old Series',
      subjects: ['Fantasy'],
      pageCount: 100,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      series: 'Old Series',
      seriesIndex: 2,
      subjects: ['Fantasy', 'Magic'],
      pageCount: 150,
    });

    const newPath = path.join(booksDir, 'b1.epub');
    fs.writeFileSync(newPath, makeMinimalEpub('New Book'));
    const mockImporter: ScanImporter = {
      parseEpub: () => ({
        ...FAKE_META,
        title: 'New Book',
        series: 'New Series',
        subjects: ['Horror'],
        pageCount: 80,
      }),
      partialMD5: () => 'b1',
    };

    await bookStore.reimportBook(OWNER, 'b1', mockImporter);

    const oldSeries = await prisma.series.findFirst({
      where: { userId: OWNER.userId, name: 'Old Series' },
    });
    expect(oldSeries).not.toBeNull();
    expect(oldSeries!.bookCount).toBe(1);
    expect(JSON.parse(oldSeries!.subjects)).toEqual(['Fantasy', 'Magic']);
    expect(oldSeries!.totalPages).toBe(150);

    const newSeries = await prisma.series.findFirst({
      where: { userId: OWNER.userId, name: 'New Series' },
    });
    expect(newSeries).not.toBeNull();
    expect(newSeries!.bookCount).toBe(1);
    expect(JSON.parse(newSeries!.subjects)).toEqual(['Horror']);
  });

  it('updates series meta after deleting one book when others remain', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'Dune',
      subjects: ['Science Fiction'],
      author: 'Frank Herbert',
      pageCount: 100,
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      series: 'Dune',
      seriesIndex: 2,
      subjects: ['Science Fiction', 'Politics'],
      author: 'Frank Herbert',
      pageCount: 200,
    });

    await bookStore.deleteBook(OWNER, 'b1');

    const series = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'Dune' } });
    expect(series).not.toBeNull();
    expect(series!.bookCount).toBe(1);
    expect(series!.totalPages).toBe(200);
    expect(JSON.parse(series!.subjects)).toEqual(['Politics', 'Science Fiction']);
  });

  it('deletes the series when the last book is deleted', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      series: 'Dune',
    });

    await bookStore.deleteBook(OWNER, 'b1');

    const series = await prisma.series.findFirst({ where: { userId: OWNER.userId, name: 'Dune' } });
    expect(series).toBeNull();
  });
});

describe('BookStore.listBooksPage() — search filters', () => {
  it('filters standalones by query (title contains)', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      series: '',
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'A Memory Called Empire',
      series: '',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { query: 'fifth' });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('filters series by query (name contains)', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Foundation 1',
      series: 'Foundation',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { query: 'dune' });
    // "Dune 1" sorts after the "Dune" series sortKey alphabetically ("dune" < "dune 1")
    expect(result.items).toEqual([
      { type: 'series', seriesName: 'Dune' },
      { type: 'standalone', bookId: 'b1' },
    ]);
  });

  it('filters series by member book title (not just series name)', async () => {
    await bookStore.addBook(OWNER, 's1', stage('s1'), {
      ...FAKE_META,
      title: 'The Fifth Season',
      series: 'Broken Earth',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { query: 'Fifth Season' });
    // Series sorts before book ("broken earth" < "the fifth season")
    expect(result.items).toEqual([
      { type: 'series', seriesName: 'Broken Earth' },
      { type: 'standalone', bookId: 's1' },
    ]);
  });

  it('includes series member books as individual results when their title matches query', async () => {
    await bookStore.addBook(OWNER, 's1', stage('s1'), {
      ...FAKE_META,
      title: "Abaddon's Gate",
      series: 'The Expanse',
    });
    await bookStore.addBook(OWNER, 's2', stage('s2'), {
      ...FAKE_META,
      title: 'Leviathan Wakes',
      series: 'The Expanse',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { query: 'gate' });
    // "Abaddon's Gate" sorts before "The Expanse" series ("abaddon" < "the expanse")
    // "Leviathan Wakes" does not match "gate" so it is absent
    expect(result.items).toEqual([
      { type: 'standalone', bookId: 's1' },
      { type: 'series', seriesName: 'The Expanse' },
    ]);
  });

  it('filters standalones by author (contains, case-insensitive)', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Book A',
      author: 'N.K. Jemisin',
      series: '',
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Book B',
      author: 'Arkady Martine',
      series: '',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { author: 'jemisin' });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });

  it('filters series by author field', async () => {
    await bookStore.addBook(OWNER, 's1', stage('s1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
      author: 'Frank Herbert',
    });
    await bookStore.addBook(OWNER, 's2', stage('s2'), {
      ...FAKE_META,
      title: 'Foundation 1',
      series: 'Foundation',
      author: 'Isaac Asimov',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { author: 'Herbert' });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('filters by seriesName: shows only the named series (no standalones)', async () => {
    await bookStore.addBook(OWNER, 's1', stage('s1'), {
      ...FAKE_META,
      title: 'Dune 1',
      series: 'Dune',
    });
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Standalone',
      series: '',
    });
    const result = await bookStore.listBooksPage(OWNER, null, 20, { seriesName: 'Dune' });
    expect(result.items).toEqual([{ type: 'series', seriesName: 'Dune' }]);
  });

  it('filters standalones by multiple subjects (AND)', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      title: 'Book A',
      series: '',
      subjects: ['Fantasy', 'Fiction'],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      title: 'Book B',
      series: '',
      subjects: ['Fantasy'],
    });
    await bookStore.addBook(OWNER, 'b3', stage('b3'), {
      ...FAKE_META,
      title: 'Book C',
      series: '',
      subjects: ['Fiction'],
    });
    // Only b1 has both subjects; b2 (Fantasy only) and b3 (Fiction only) must be excluded
    const result = await bookStore.listBooksPage(OWNER, null, 20, {
      subjects: ['Fantasy', 'Fiction'],
    });
    expect(result.items).toEqual([{ type: 'standalone', bookId: 'b1' }]);
  });
});

describe('getAuthors', () => {
  it('returns empty array when no books', async () => {
    const authors = await bookStore.getAuthors(OWNER);
    expect(authors).toEqual([]);
  });

  it('returns distinct authors sorted alphabetically', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      author: 'Zora Neale Hurston',
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      author: 'Agatha Christie',
    });
    await bookStore.addBook(OWNER, 'b3', stage('b3'), {
      ...FAKE_META,
      author: 'Agatha Christie',
    });
    const authors = await bookStore.getAuthors(OWNER);
    expect(authors).toEqual(['Agatha Christie', 'Zora Neale Hurston']);
  });

  it('excludes books with empty author', async () => {
    await bookStore.addBook(OWNER, 'b4', stage('b4'), { ...FAKE_META, author: '' });
    await bookStore.addBook(OWNER, 'b4b', stage('b4b'), { ...FAKE_META, author: 'Real Author' });
    const authors = await bookStore.getAuthors(OWNER);
    expect(authors).toEqual(['Real Author']);
  });

  it('is scoped to owner', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await bookStore.addBook(alice, 'b5', stage('b5'), { ...FAKE_META, author: 'Alice Author' });
    await bookStore.addBook(bob, 'b6', stage('b6'), { ...FAKE_META, author: 'Bob Author' });
    const authors = await bookStore.getAuthors(alice);
    expect(authors).toContain('Alice Author');
    expect(authors).not.toContain('Bob Author');
  });
});

describe('listBooksByAuthor', () => {
  it('returns empty array for unknown author', async () => {
    const books = await bookStore.listBooksByAuthor(OWNER, 'No One');
    expect(books).toEqual([]);
  });

  it('returns only books by the given author', async () => {
    await bookStore.addBook(OWNER, 'c1', stage('c1'), {
      ...FAKE_META,
      author: 'Jane Austen',
      title: 'Persuasion',
    });
    await bookStore.addBook(OWNER, 'c2', stage('c2'), {
      ...FAKE_META,
      author: 'Jane Austen',
      title: 'Emma',
    });
    await bookStore.addBook(OWNER, 'c3', stage('c3'), {
      ...FAKE_META,
      author: 'Other Author',
      title: 'Other Book',
    });
    const books = await bookStore.listBooksByAuthor(OWNER, 'Jane Austen');
    expect(books.map((b) => b.title)).toEqual(['Emma', 'Persuasion']);
  });

  it('is scoped to owner', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await bookStore.addBook(alice, 'c4', stage('c4'), {
      ...FAKE_META,
      author: 'Shared Author',
      title: 'Alice Copy',
    });
    await bookStore.addBook(bob, 'c5', stage('c5'), {
      ...FAKE_META,
      author: 'Shared Author',
      title: 'Bob Copy',
    });
    const books = await bookStore.listBooksByAuthor(alice, 'Shared Author');
    expect(books.map((b) => b.title)).toEqual(['Alice Copy']);
  });
});

describe('listSeries', () => {
  it('returns empty array when no series exist', async () => {
    const series = await bookStore.listSeries(OWNER);
    expect(series).toEqual([]);
  });

  it('returns series sorted by name', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await bookStore.addBook(alice, 'd1', stage('d1'), {
      ...FAKE_META,
      series: 'Dune',
      seriesIndex: 1,
    });
    await bookStore.addBook(alice, 'd2', stage('d2'), {
      ...FAKE_META,
      series: 'Foundation',
      seriesIndex: 1,
    });
    const series = await bookStore.listSeries(alice);
    expect(series.map((s) => s.name)).toEqual(['Dune', 'Foundation']);
    expect(series[0].bookCount).toBe(1);
  });

  it('is scoped to owner', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await bookStore.addBook(alice, 'd3', stage('d3'), {
      ...FAKE_META,
      series: 'Alice Series',
      seriesIndex: 1,
    });
    await bookStore.addBook(bob, 'd4', stage('d4'), {
      ...FAKE_META,
      series: 'Bob Series',
      seriesIndex: 1,
    });
    const series = await bookStore.listSeries(alice);
    expect(series.map((s) => s.name)).toContain('Alice Series');
    expect(series.map((s) => s.name)).not.toContain('Bob Series');
  });
});

describe('listBooksBySeries', () => {
  it('returns empty array for unknown seriesId', async () => {
    const books = await bookStore.listBooksBySeries(OWNER, 'nonexistent-uuid');
    expect(books).toEqual([]);
  });

  it('returns books sorted by seriesIndex then title', async () => {
    const alice: Owner = OWNER;
    await bookStore.addBook(alice, 'e1', stage('e1'), {
      ...FAKE_META,
      series: 'The Expanse',
      seriesIndex: 1,
      title: 'Leviathan Wakes',
    });
    await bookStore.addBook(alice, 'e2', stage('e2'), {
      ...FAKE_META,
      series: 'The Expanse',
      seriesIndex: 3,
      title: "Abaddon's Gate",
    });
    await bookStore.addBook(alice, 'e3', stage('e3'), {
      ...FAKE_META,
      series: 'The Expanse',
      seriesIndex: 2,
      title: "Caliban's War",
    });
    const allSeries = await bookStore.listSeries(alice);
    const expanse = allSeries.find((s) => s.name === 'The Expanse')!;
    const books = await bookStore.listBooksBySeries(alice, expanse.id);
    expect(books.map((b) => b.title)).toEqual([
      'Leviathan Wakes',
      "Caliban's War",
      "Abaddon's Gate",
    ]);
  });

  it('is scoped to owner', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await bookStore.addBook(alice, 'e4', stage('e4'), {
      ...FAKE_META,
      series: 'Shared Series',
      seriesIndex: 1,
      title: 'Alice Book',
    });
    await bookStore.addBook(bob, 'e5', stage('e5'), {
      ...FAKE_META,
      series: 'Shared Series',
      seriesIndex: 1,
      title: 'Bob Book',
    });
    const aliceSeries = await bookStore.listSeries(alice);
    const s = aliceSeries.find((s) => s.name === 'Shared Series')!;
    const books = await bookStore.listBooksBySeries(alice, s.id);
    expect(books.map((b) => b.title)).toEqual(['Alice Book']);
  });
});

describe('listBooksBySubject', () => {
  it('returns empty array when no books have the subject', async () => {
    const books = await bookStore.listBooksBySubject(OWNER, 'Fantasy');
    expect(books).toEqual([]);
  });

  it('returns only books tagged with the given subject', async () => {
    await bookStore.addBook(OWNER, 'f1', stage('f1'), {
      ...FAKE_META,
      title: 'A Fantasy Book',
      subjects: ['Fantasy', 'Adventure'],
    });
    await bookStore.addBook(OWNER, 'f2', stage('f2'), {
      ...FAKE_META,
      title: 'A Sci-Fi Book',
      subjects: ['Science Fiction'],
    });
    await bookStore.addBook(OWNER, 'f3', stage('f3'), {
      ...FAKE_META,
      title: 'Another Fantasy',
      subjects: ['Fantasy'],
    });
    const books = await bookStore.listBooksBySubject(OWNER, 'Fantasy');
    expect(books.map((b) => b.title).sort()).toEqual(['A Fantasy Book', 'Another Fantasy']);
  });

  it('is scoped to owner', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await bookStore.addBook(alice, 'f4', stage('f4'), {
      ...FAKE_META,
      title: 'Alice Fantasy',
      subjects: ['Fantasy'],
    });
    await bookStore.addBook(bob, 'f5', stage('f5'), {
      ...FAKE_META,
      title: 'Bob Fantasy',
      subjects: ['Fantasy'],
    });
    const books = await bookStore.listBooksBySubject(alice, 'Fantasy');
    expect(books.map((b) => b.title)).toContain('Alice Fantasy');
    expect(books.map((b) => b.title)).not.toContain('Bob Fantasy');
  });
});

describe('listBooksByStatus', () => {
  async function setProgress(userId: string, bookId: string, percentage: number): Promise<void> {
    await prisma.progress.upsert({
      where: { userId_document: { userId, document: bookId } },
      create: {
        userId,
        document: bookId,
        progress: String(percentage),
        percentage,
        device: 'test',
        deviceId: 'test-device',
        timestamp: Math.floor(Date.now() / 1000),
      },
      update: { percentage },
    });
  }

  it('returns all books for not-started when none have progress', async () => {
    await bookStore.addBook(OWNER, 'g1', stage('g1'), { ...FAKE_META, title: 'Book A' });
    const books = await bookStore.listBooksByStatus(OWNER, 'not-started');
    expect(books.map((b) => b.id)).toContain('g1');
  });

  it('not-started excludes books with any progress', async () => {
    await bookStore.addBook(OWNER, 'g2', stage('g2'), { ...FAKE_META, title: 'Started Book' });
    await setProgress(OWNER.userId, 'g2', 0.5);
    const books = await bookStore.listBooksByStatus(OWNER, 'not-started');
    expect(books.map((b) => b.id)).not.toContain('g2');
  });

  it('in-progress returns only partially read books', async () => {
    await bookStore.addBook(OWNER, 'g3', stage('g3'), { ...FAKE_META, title: 'In Progress' });
    await bookStore.addBook(OWNER, 'g4', stage('g4'), { ...FAKE_META, title: 'Unread' });
    await bookStore.addBook(OWNER, 'g5', stage('g5'), { ...FAKE_META, title: 'Done' });
    await setProgress(OWNER.userId, 'g3', 0.5);
    await setProgress(OWNER.userId, 'g5', 1.0);
    const books = await bookStore.listBooksByStatus(OWNER, 'in-progress');
    expect(books.map((b) => b.id)).toEqual(['g3']);
  });

  it('completed returns only fully read books', async () => {
    await bookStore.addBook(OWNER, 'g6', stage('g6'), { ...FAKE_META, title: 'Complete' });
    await bookStore.addBook(OWNER, 'g7', stage('g7'), { ...FAKE_META, title: 'Partial' });
    await setProgress(OWNER.userId, 'g6', 1.0);
    await setProgress(OWNER.userId, 'g7', 0.3);
    const books = await bookStore.listBooksByStatus(OWNER, 'completed');
    expect(books.map((b) => b.id)).toEqual(['g6']);
  });

  it('is scoped to owner', async () => {
    const alice: Owner = OWNER;
    const bob: Owner = { userId: 'usr_test000000000000001', username: 'bob' };
    await prisma.user.create({ data: { id: bob.userId, username: bob.username } });
    fs.mkdirSync(path.join(booksRoot, bob.username), { recursive: true });

    await bookStore.addBook(alice, 'g8', stage('g8'), { ...FAKE_META, title: 'Alice Book' });
    await bookStore.addBook(bob, 'g9', stage('g9'), { ...FAKE_META, title: 'Bob Book' });
    await setProgress(alice.userId, 'g8', 1.0);
    await setProgress(bob.userId, 'g9', 1.0);
    const books = await bookStore.listBooksByStatus(alice, 'completed');
    expect(books.map((b) => b.id)).toContain('g8');
    expect(books.map((b) => b.id)).not.toContain('g9');
  });
});

describe('BookStore.getChapterSpineMaps', () => {
  it('returns parsed spine maps keyed by id and omits missing books', async () => {
    await bookStore.addBook(OWNER, 'has-map', stage('has-map'), {
      ...FAKE_META,
      chapterCount: 3,
      chapterSpineMap: [1, 2, 3],
    });
    const map = await bookStore.getChapterSpineMaps(OWNER, ['has-map', 'missing']);
    expect(map.get('has-map')).toEqual([1, 2, 3]);
    expect(map.has('missing')).toBe(false);
  });

  it('returns an empty map for an empty id list (no query)', async () => {
    const map = await bookStore.getChapterSpineMaps(OWNER, []);
    expect(map.size).toBe(0);
  });
});

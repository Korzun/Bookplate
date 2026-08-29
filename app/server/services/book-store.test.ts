import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import AdmZip from 'adm-zip';

import { runMigrations } from '../db/migrate';
import { EpubMeta, Owner, PageCursor } from '../types';
import { getThumbnail, saveThumbnail } from './book-assets';
import { getBookById, listBooks } from './book-catalog';
import { BookHashCollisionError } from './book-errors';
import { BookStore, ScanImporter } from './book-store';
import { countForBook, purgeForBook } from './edition';
import { partialMD5 } from './epub-parser';

vi.mock('../logger');
// Call-through by default (see edition.test.ts's identical pattern) so every
// test but the ones that explicitly stub `purgeForBook`/`countForBook` below
// still exercises the real functions against the real (temp) DB and disk.
vi.mock('./edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./edition')>()),
  purgeForBook: vi.fn((await importOriginal<typeof import('./edition')>()).purgeForBook),
  countForBook: vi.fn((await importOriginal<typeof import('./edition')>()).countForBook),
}));

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
  // Mock reset (implementations, queued once-behaviors, call history) is
  // handled globally by vite.config.ts's `mockReset: true`, which restores
  // the purgeForBook/countForBook vi.fn(impl) mocks here to their
  // call-through default before each test.
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
  fs.rmSync(booksRoot, { recursive: true });
});

// Split from a combined `describe('addBook and listBooks', ...)` (task 4):
// the `it`s testing `listBooks`'/`getBookById`'s own field-mapping and sort
// contract moved to `book-catalog.test.ts`'s `describe('listBooks and
// getBookById — field mapping', ...)`. These five stay — each is about
// `addBook`'s own write-path mechanics (duplicate-id rejection, the file
// move/no-op, per-owner isolation, stat-ing size/mtime), using `getBookById`/
// `listBooks` only as read-back tooling to observe the result.
describe('addBook', () => {
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

    expect((await listBooks(prisma, booksRoot, OWNER)).map((b) => b.id)).toEqual(['shared-id']);
    expect((await listBooks(prisma, booksRoot, other)).map((b) => b.id)).toEqual(['shared-id']);
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
    const book = await getBookById(prisma, booksRoot, OWNER, 'size-id');
    expect(book!.size).toBe(10);
    expect(Math.abs(book!.mtime.getTime() - Date.now())).toBeLessThan(5000);
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

  it('strips a leading article from the series sortKey', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, series: 'The Expanse' });
    const row = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'The Expanse' } },
    });
    expect(row!.name).toBe('The Expanse');
    expect(row!.sortKey).toBe('Expanse');
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

describe('deleteBook', () => {
  it('removes book from db and returns it', async () => {
    await bookStore.addBook(OWNER, 'del1', stage('del1'), FAKE_META);
    const deleted = await bookStore.deleteBook(OWNER, 'del1');
    expect(deleted).not.toBeNull();
    expect(deleted!.id).toBe('del1');
    expect(await listBooks(prisma, booksRoot, OWNER)).toHaveLength(0);
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

  it('purges editions for the book', async () => {
    await bookStore.addBook(OWNER, 'del3', stage('del3'), FAKE_META);
    await bookStore.deleteBook(OWNER, 'del3');
    expect(purgeForBook).toHaveBeenCalledWith(
      expect.anything(),
      editionsRoot,
      OWNER.userId,
      'del3'
    );
  });
});

describe('clearDeviceEditions', () => {
  it('returns null for an unknown book and does not purge', async () => {
    expect(await bookStore.clearDeviceEditions(OWNER, 'nope')).toBeNull();
    expect(purgeForBook).not.toHaveBeenCalled();
  });

  it('purges editions and returns the count for an existing book', async () => {
    vi.mocked(countForBook).mockResolvedValueOnce(3);
    await bookStore.addBook(OWNER, 'clr1', stage('clr1'), FAKE_META);
    const cleared = await bookStore.clearDeviceEditions(OWNER, 'clr1');
    expect(cleared).toBe(3);
    expect(purgeForBook).toHaveBeenCalledWith(
      expect.anything(),
      editionsRoot,
      OWNER.userId,
      'clr1'
    );
  });

  it('removes edition rows and files via the real edition purge', async () => {
    await bookStore.addBook(OWNER, 'clr2', stage('clr2'), FAKE_META);
    await prisma.device.create({
      data: { id: 'dv2', name: 'K', slug: 'k', coverFit: 'contain' },
    });
    await prisma.deviceEdition.create({
      data: {
        userId: OWNER.userId,
        originalBookId: 'clr2',
        deviceId: 'dv2',
        editionId: 'e',
        settingsHash: 'h',
      },
    });
    const editionFile = path.join(editionsRoot, 'dv2', OWNER.userId, 'clr2.epub');
    fs.mkdirSync(path.dirname(editionFile), { recursive: true });
    fs.writeFileSync(editionFile, 'X');

    const cleared = await bookStore.clearDeviceEditions(OWNER, 'clr2');
    expect(cleared).toBe(1);
    expect(await prisma.deviceEdition.count({ where: { originalBookId: 'clr2' } })).toBe(0);
    expect(fs.existsSync(editionFile)).toBe(false);
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
    const books = await listBooks(prisma, booksRoot, OWNER);
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
    expect(await listBooks(prisma, booksRoot, OWNER)).toHaveLength(1);
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
    expect(await listBooks(prisma, booksRoot, OWNER)).toHaveLength(1);
    const result = await bookStore.scan(OWNER, makeMockImporter());
    expect(result.removed).toEqual(['ghostid001.epub']);
    expect(result.imported).toEqual([]);
    expect(await listBooks(prisma, booksRoot, OWNER)).toHaveLength(0);
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
    const books = await listBooks(prisma, booksRoot, OWNER);
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
    expect(await getBookById(prisma, booksRoot, OWNER, id)).toBeNull();
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
    const book = await getBookById(prisma, booksRoot, OWNER, 'id1');
    expect(book?.publisher).toBe('Test Publisher');
  });

  it('stores and retrieves identifiers (JSON round-trip)', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), FAKE_META);
    const book = await getBookById(prisma, booksRoot, OWNER, 'id1');
    expect(book?.identifiers).toEqual([{ scheme: 'ISBN', value: '978-0000000000' }]);
  });

  it('stores and retrieves subjects (JSON round-trip)', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), FAKE_META);
    const book = await getBookById(prisma, booksRoot, OWNER, 'id1');
    expect(book?.subjects).toEqual(['Fiction']);
  });

  it('stores empty identifiers as empty array', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), {
      ...FAKE_META,
      identifiers: [],
    });
    const book = await getBookById(prisma, booksRoot, OWNER, 'id1');
    expect(book?.identifiers).toEqual([]);
  });

  it('stores empty subjects as empty array', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), {
      ...FAKE_META,
      subjects: [],
    });
    const book = await getBookById(prisma, booksRoot, OWNER, 'id1');
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
    const book = await getBookById(prisma, booksRoot, OWNER, 'id1');
    expect(book?.chapterCount).toBe(12);
  });

  it('stores and retrieves chapterSpineMap (JSON round-trip)', async () => {
    const spineMap = [2, 4, 6, 8];
    await bookStore.addBook(OWNER, 'id2', stage('id2'), {
      ...FAKE_META,
      chapterCount: 4,
      chapterSpineMap: spineMap,
    });
    const book = await getBookById(prisma, booksRoot, OWNER, 'id2');
    expect(book?.chapterSpineMap).toEqual(spineMap);
  });

  it('defaults to chapterCount 0 and empty chapterSpineMap', async () => {
    await bookStore.addBook(OWNER, 'id3', stage('id3'), FAKE_META);
    const book = await getBookById(prisma, booksRoot, OWNER, 'id3');
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
    expect((await getBookById(prisma, booksRoot, OWNER, 'id1'))?.pageCount).toBe(42);
  });

  it('defaults to 0 when pageCount is not set', async () => {
    await bookStore.addBook(OWNER, 'id2', stage('id2'), { ...FAKE_META, pageCount: 0 });
    expect((await getBookById(prisma, booksRoot, OWNER, 'id2'))?.pageCount).toBe(0);
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

  it('purges editions for the book', async () => {
    const stagedPath = path.join(booksDir, 'staged-purge.epub');
    fs.writeFileSync(stagedPath, makeMinimalEpub('Purge'));
    const id = partialMD5(stagedPath);
    await bookStore.addBook(OWNER, id, stagedPath, FAKE_META);

    const importer: ScanImporter = {
      parseEpub: () => ({ ...FAKE_META, title: 'Purged' }),
      partialMD5: () => id,
    };
    await bookStore.reimportBook(OWNER, id, importer);

    expect(purgeForBook).toHaveBeenCalledWith(expect.anything(), editionsRoot, OWNER.userId, id);
  });

  it('still resolves successfully when edition purge throws', async () => {
    vi.mocked(purgeForBook).mockRejectedValueOnce(new Error('purge boom'));

    const stagedPath = path.join(booksDir, 'staged-purge-throws.epub');
    fs.writeFileSync(stagedPath, makeMinimalEpub('Purge Throws'));
    const id = partialMD5(stagedPath);
    await bookStore.addBook(OWNER, id, stagedPath, FAKE_META);

    const importer: ScanImporter = {
      parseEpub: () => ({ ...FAKE_META, title: 'Purged Throws' }),
      partialMD5: () => id,
    };

    const result = await bookStore.reimportBook(OWNER, id, importer);

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Purged Throws');
    expect(purgeForBook).toHaveBeenCalledWith(expect.anything(), editionsRoot, OWNER.userId, id);
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
    await saveThumbnail(prisma, OWNER.userId, id, 150, Buffer.from('thumb-old'), 'image/jpeg');
    expect(await getThumbnail(prisma, OWNER.userId, id, 150)).not.toBeNull();

    const importer: ScanImporter = {
      parseEpub: () => ({ ...FAKE_META, coverData: Buffer.from('fake-cover-NEW') }),
      partialMD5: () => id,
    };
    await bookStore.reimportBook(OWNER, id, importer);

    expect(await getThumbnail(prisma, OWNER.userId, id, 150)).toBeNull();
  });

  it('keeps thumbnails when the cover is unchanged on reimport', async () => {
    const stagedPath = path.join(booksDir, 'staged-cover-same.epub');
    fs.writeFileSync(stagedPath, makeMinimalEpub('CoverSame'));
    const id = partialMD5(stagedPath);
    await bookStore.addBook(OWNER, id, stagedPath, FAKE_META);
    await saveThumbnail(prisma, OWNER.userId, id, 150, Buffer.from('thumb-keep'), 'image/jpeg');

    const importer: ScanImporter = {
      // Same cover bytes as FAKE_META, but a changed title to prove the reimport ran.
      parseEpub: () => ({ ...FAKE_META, title: 'Renamed' }),
      partialMD5: () => id,
    };
    await bookStore.reimportBook(OWNER, id, importer);

    const thumb = await getThumbnail(prisma, OWNER.userId, id, 150);
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
    expect(await getBookById(prisma, booksRoot, OWNER, newId)).not.toBeNull();
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

describe('book_thumbnails — cascades via deleteBook/reimportBook', () => {
  it('deleting a book cascades to book_thumbnails', async () => {
    await bookStore.addBook(OWNER, 'bk9', stage('bk9'), FAKE_META);
    await saveThumbnail(prisma, OWNER.userId, 'bk9', 60, Buffer.from('x'), 'image/jpeg');
    await bookStore.deleteBook(OWNER, 'bk9');
    expect(await getThumbnail(prisma, OWNER.userId, 'bk9', 60)).toBeNull();
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
    await saveThumbnail(prisma, OWNER.userId, originalId, 60, Buffer.from('thumb'), 'image/jpeg');

    const mockImporter = {
      parseEpub: () => FAKE_META,
      partialMD5: () => newId,
    };
    await bookStore.reimportBook(OWNER, originalId, mockImporter);

    // Thumbnail should now be under new ID (not lost, not causing FK error)
    expect(await getThumbnail(prisma, OWNER.userId, newId, 60)).not.toBeNull();
    expect(await getThumbnail(prisma, OWNER.userId, originalId, 60)).toBeNull();
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
    expect(await getBookById(prisma, booksRoot, OWNER, bookAId)).not.toBeNull();
    expect(await getBookById(prisma, booksRoot, OWNER, bookBId)).not.toBeNull();
  });
});

// This describe stays (task 5) — it asserts `deleteBook`'s FK cascade onto
// `pending_fixes`, not `upsertPendingFix`/`deletePendingFix`'s own behaviour.
// `describe('PendingFix store', ...)`, which DID test those, moved whole to
// `services/pending-fix.test.ts` (minus one dropped `it` — see that file's
// header comment).
describe('pending_fixes table', () => {
  it('round-trips a row and cascades on book delete', async () => {
    await bookStore.addBook(OWNER, 'abc123', stage('abc123'), FAKE_META);
    await prisma.pendingFix.create({
      data: {
        userId: OWNER.userId,
        bookId: 'abc123',
        fileName: 'x.epub',
        fileSize: 10,
        state: '{"autoFixes":[],"appliedFixes":[],"proposals":[],"undo":null}',
        updatedAt: 1,
      },
    });
    expect(await prisma.pendingFix.findMany({ where: { userId: OWNER.userId } })).toHaveLength(1);

    await bookStore.deleteBook(OWNER, 'abc123');
    expect(await prisma.pendingFix.findMany({ where: { userId: OWNER.userId } })).toHaveLength(0);
  });
});

// Split from a combined `describe('book_id_history table', ...)` (task 5):
// the 4 `it`s testing `resolveBookId`'s own behaviour moved to
// `book-lineage.test.ts`'s `describe('resolveBookId', ...)`. The 3 below
// stayed — each asserts on the table itself (column presence, the `type`
// CHECK constraint), not on any moved function.
describe('book_id_history table', () => {
  it('creates the book_id_history table during migration', async () => {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM pragma_table_info('book_id_history')
    `;
    const names = cols.map((c) => c.name);
    expect(names).toContain('old_id');
    expect(names).toContain('current_id');
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

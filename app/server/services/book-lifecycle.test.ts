import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import AdmZip from 'adm-zip';

import { runMigrations } from '../db/migrate';
import { EpubMeta, Owner } from '../types';
import { getThumbnail, saveThumbnail } from './book-assets';
import { getBookById, listBooks } from './book-catalog';
import { BookHashCollisionError } from './book-errors';
import { BookStore } from './book-store';
import { countForBook, purgeForBook } from './edition';

vi.mock('../logger');
// Call-through by default (see edition.test.ts's identical pattern) so every
// test but the ones that explicitly stub `purgeForBook`/`countForBook` below
// still exercises the real functions against the real (temp) DB and disk.
vi.mock('./edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./edition')>()),
  purgeForBook: vi.fn((await importOriginal<typeof import('./edition')>()).purgeForBook),
  countForBook: vi.fn((await importOriginal<typeof import('./edition')>()).countForBook),
}));
// `ScanImporter` is gone — `reimportBook`/`scan` now import `parseEpub`/
// `partialMD5` directly from `./epub-parser`, so per-test fakes now go
// through this module mock instead of a constructor argument. `vi.fn(actual.X)`
// self-heals back to the real implementation on every `mockReset` (vitest
// restores a `vi.fn(impl)` mock's *constructor-time* `impl`, not `undefined`,
// on reset — verified against `@vitest/spy`'s source and proven by this same
// call-through pattern already working for the `./edition` mock above), so
// every test that doesn't override parseEpub/partialMD5 still exercises the
// real parser/hasher against the real (temp-file) disk — exactly as it did
// via `BookStore`'s old `defaultImporter`. Tests that need a fake stub it
// with `mockImplementationOnce`/`mockImplementation`, which `mockReset`
// clears before the next test runs either way.
vi.mock('./epub-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./epub-parser')>();
  return { ...actual, parseEpub: vi.fn(actual.parseEpub), partialMD5: vi.fn(actual.partialMD5) };
});

import { parseEpub, partialMD5 } from './epub-parser';

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

function stage(id: string, content: string | Buffer = 'x'): string {
  const p = path.join(booksDir, `staged-${id}.epub`);
  fs.writeFileSync(p, content);
  return p;
}

// Direct SQL helper scoped to OWNER, keeping the per-user table shape in mind.
// Duplicated from `book-store.test.ts` (still needed there for `book_id_history
// table`'s own tests) rather than shared, mirroring `stage`'s established
// per-file duplication (task 4's `book-catalog.test.ts`, task 5's
// `book-lineage.test.ts`).
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
  // the purgeForBook/countForBook/parseEpub/partialMD5 vi.fn(impl) mocks
  // here to their call-through default before each test.
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
  // Arms the mocked parseEpub/partialMD5 for exactly the next reimportBook
  // call — replaces the describe-local `makeImporterWithMeta(meta):
  // ScanImporter` helper this file used before `reimportBook` took its
  // importer via direct module imports instead of a constructor argument.
  function armImporterWithMeta(meta: Partial<EpubMeta>): void {
    vi.mocked(parseEpub).mockImplementationOnce(() => ({ ...FAKE_META, ...meta }));
    vi.mocked(partialMD5).mockImplementationOnce((fp) =>
      crypto.createHash('md5').update(fp).digest('hex')
    );
  }

  it('upserts a new Series when series name changes', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), { ...FAKE_META, series: 'Old' });
    armImporterWithMeta({ series: 'New' });
    await bookStore.reimportBook(OWNER, 'id1');
    const newRow = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'New' } },
    });
    expect(newRow).not.toBeNull();
  });

  it('deletes the old Series when series name changes and it has no other books', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), { ...FAKE_META, series: 'Old' });
    armImporterWithMeta({ series: 'New' });
    await bookStore.reimportBook(OWNER, 'id1');
    const oldRow = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Old' } },
    });
    expect(oldRow).toBeNull();
  });

  it('keeps the old Series when another book still belongs to it', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), { ...FAKE_META, series: 'Old' });
    await bookStore.addBook(OWNER, 'id2', stage('id2'), { ...FAKE_META, series: 'Old' });
    armImporterWithMeta({ series: 'New' });
    await bookStore.reimportBook(OWNER, 'id1');
    const oldRow = await prisma.series.findUnique({
      where: { userId_name: { userId: OWNER.userId, name: 'Old' } },
    });
    expect(oldRow).not.toBeNull();
  });

  it('clears seriesId when series name becomes empty', async () => {
    await bookStore.addBook(OWNER, 'id1', stage('id1'), { ...FAKE_META, series: 'Old' });
    // Use a fixed partialMD5 that returns the same id so the book row stays at 'id1'
    vi.mocked(parseEpub).mockImplementationOnce(() => ({ ...FAKE_META, series: '' }));
    vi.mocked(partialMD5).mockImplementationOnce(() => 'id1');
    await bookStore.reimportBook(OWNER, 'id1');
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

const MOCK_META: EpubMeta = {
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
};

// Arms parseEpub/partialMD5 with a persistent (not "once") stub — matching
// how `makeMockImporter()`'s fresh `ScanImporter` object used to be handed
// to every `scan()` call in a test, including tests that call `scan()` more
// than once. `partialMD5` still keys off the real filePath argument, exactly
// as `makeMockImporter()`'s did.
function armMockImporter(): void {
  vi.mocked(parseEpub).mockImplementation((): EpubMeta => MOCK_META);
  vi.mocked(partialMD5).mockImplementation((filePath: string): string =>
    crypto.createHash('md5').update(filePath).digest('hex')
  );
}

describe('BookStore.scan()', () => {
  it('returns empty lists when booksDir is empty and DB is empty', async () => {
    armMockImporter();
    const result = await bookStore.scan(OWNER);
    expect(result).toEqual({ imported: [], removed: [] });
  });

  it('imports an epub found on disk but not in DB', async () => {
    const filePath = path.join(booksDir, 'new-book.epub');
    fs.writeFileSync(filePath, 'fake-epub-content');
    armMockImporter();
    const result = await bookStore.scan(OWNER);
    expect(result.imported).toEqual(['new-book.epub']);
    expect(result.removed).toEqual([]);
    const books = await listBooks(prisma, booksRoot, OWNER);
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe('Mock Title');
  });

  it('does not re-import a book already in the DB', async () => {
    const filePath = path.join(booksDir, 'existing.epub');
    fs.writeFileSync(filePath, 'fake-epub-content');
    armMockImporter();
    await bookStore.scan(OWNER); // first scan imports it
    const result = await bookStore.scan(OWNER); // second scan is a no-op
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
    armMockImporter();
    const result = await bookStore.scan(OWNER);
    expect(result.removed).toEqual(['ghostid001.epub']);
    expect(result.imported).toEqual([]);
    expect(await listBooks(prisma, booksRoot, OWNER)).toHaveLength(0);
  });

  it('skips a file that fails to parse and continues scanning others', async () => {
    fs.writeFileSync(path.join(booksDir, 'bad.epub'), 'bad');
    fs.writeFileSync(path.join(booksDir, 'good.epub'), 'good');
    vi.mocked(parseEpub).mockImplementation((filePath: string): EpubMeta => {
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
    });
    vi.mocked(partialMD5).mockImplementation((filePath: string): string =>
      crypto.createHash('md5').update(filePath).digest('hex')
    );
    const result = await bookStore.scan(OWNER);
    expect(result.imported).toHaveLength(1);
    expect(result.imported).toContain('good.epub');
    expect(result.removed).toEqual([]);
  });

  it('ignores non-epub files in booksDir', async () => {
    fs.writeFileSync(path.join(booksDir, 'readme.txt'), 'text');
    fs.writeFileSync(path.join(booksDir, 'book.epub'), 'epub');
    armMockImporter();
    const result = await bookStore.scan(OWNER);
    expect(result.imported).toEqual(['book.epub']);
  });

  it('renames a non-canonically-named file to <id>.epub before importing', async () => {
    const arbitraryPath = path.join(booksDir, 'arbitrary-name.epub');
    fs.writeFileSync(arbitraryPath, makeMinimalEpub('A Book'));
    armMockImporter();
    const result = await bookStore.scan(OWNER);
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

    armMockImporter();
    const result = await bookStore.scan(OWNER);
    expect(result.removed).toContain(id + '.epub');
    expect(await getBookById(prisma, booksRoot, OWNER, id)).toBeNull();
  });

  it('skips canonically-named files already in the DB without calling partialMD5', async () => {
    // Set up: a book exists at <id>.epub with id in DB.
    const id = 'a1b2c3d4e5f6789012345678901234ab';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, makeMinimalEpub('Already Here'));
    await bookStore.addBook(OWNER, id, filePath, FAKE_META);

    // partialMD5 should NOT be called for this file — the fast path (a
    // canonically-named file whose id is already in the DB) skips straight
    // to `emit('already-imported', ...)` before either import function runs.
    const result = await bookStore.scan(OWNER);
    expect(result.imported).toEqual([]);
    expect(partialMD5).not.toHaveBeenCalled();
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

describe('reimportBook', () => {
  it('returns null for unknown book id', async () => {
    expect(await bookStore.reimportBook(OWNER, 'doesnotexist')).toBeNull();
  });

  it('purges editions for the book', async () => {
    const stagedPath = path.join(booksDir, 'staged-purge.epub');
    fs.writeFileSync(stagedPath, makeMinimalEpub('Purge'));
    const id = partialMD5(stagedPath);
    await bookStore.addBook(OWNER, id, stagedPath, FAKE_META);

    vi.mocked(parseEpub).mockImplementationOnce(() => ({ ...FAKE_META, title: 'Purged' }));
    vi.mocked(partialMD5).mockImplementationOnce(() => id);
    await bookStore.reimportBook(OWNER, id);

    expect(purgeForBook).toHaveBeenCalledWith(expect.anything(), editionsRoot, OWNER.userId, id);
  });

  it('still resolves successfully when edition purge throws', async () => {
    vi.mocked(purgeForBook).mockRejectedValueOnce(new Error('purge boom'));

    const stagedPath = path.join(booksDir, 'staged-purge-throws.epub');
    fs.writeFileSync(stagedPath, makeMinimalEpub('Purge Throws'));
    const id = partialMD5(stagedPath);
    await bookStore.addBook(OWNER, id, stagedPath, FAKE_META);

    vi.mocked(parseEpub).mockImplementationOnce(() => ({ ...FAKE_META, title: 'Purged Throws' }));
    vi.mocked(partialMD5).mockImplementationOnce(() => id);

    const result = await bookStore.reimportBook(OWNER, id);

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

    vi.mocked(parseEpub).mockImplementationOnce(() => ({
      ...FAKE_META,
      coverData: Buffer.from('fake-cover-NEW'),
    }));
    vi.mocked(partialMD5).mockImplementationOnce(() => id);
    await bookStore.reimportBook(OWNER, id);

    expect(await getThumbnail(prisma, OWNER.userId, id, 150)).toBeNull();
  });

  it('keeps thumbnails when the cover is unchanged on reimport', async () => {
    const stagedPath = path.join(booksDir, 'staged-cover-same.epub');
    fs.writeFileSync(stagedPath, makeMinimalEpub('CoverSame'));
    const id = partialMD5(stagedPath);
    await bookStore.addBook(OWNER, id, stagedPath, FAKE_META);
    await saveThumbnail(prisma, OWNER.userId, id, 150, Buffer.from('thumb-keep'), 'image/jpeg');

    // Same cover bytes as FAKE_META, but a changed title to prove the reimport ran.
    vi.mocked(parseEpub).mockImplementationOnce(() => ({ ...FAKE_META, title: 'Renamed' }));
    vi.mocked(partialMD5).mockImplementationOnce(() => id);
    await bookStore.reimportBook(OWNER, id);

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

    vi.mocked(parseEpub).mockImplementationOnce(() => FAKE_META);
    vi.mocked(partialMD5).mockImplementationOnce(() => newId);
    const result = await bookStore.reimportBook(OWNER, oldId);

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

    vi.mocked(parseEpub).mockImplementationOnce(() => FAKE_META);
    vi.mocked(partialMD5).mockImplementationOnce(() => newId);
    await bookStore.reimportBook(OWNER, oldId);

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

    vi.mocked(parseEpub).mockImplementationOnce(() => FAKE_META);
    vi.mocked(partialMD5).mockImplementationOnce(() => newId);
    await bookStore.reimportBook(OWNER, originalId);

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
    vi.mocked(parseEpub).mockImplementationOnce(() => ({ ...FAKE_META, title: 'New Title' }));
    vi.mocked(partialMD5).mockImplementationOnce(() => newId);
    await bookStore.reimportBook(OWNER, oldId);

    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(path.join(booksDir, newId + '.epub'))).toBe(true);
  });

  it('does not rename when hash is unchanged', async () => {
    const id = 'stable-id';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, 'epub-bytes');
    await bookStore.addBook(OWNER, id, filePath, FAKE_META);

    vi.mocked(parseEpub).mockImplementationOnce(() => ({ ...FAKE_META, title: 'Edited' }));
    vi.mocked(partialMD5).mockImplementationOnce(() => id);
    await bookStore.reimportBook(OWNER, id);

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
    vi.mocked(parseEpub).mockImplementationOnce(() => FAKE_META);
    vi.mocked(partialMD5).mockImplementationOnce(() => bookBId);

    await expect(bookStore.reimportBook(OWNER, bookAId)).rejects.toThrow(BookHashCollisionError);
    // Both books must remain intact after the failed reimport
    expect(await getBookById(prisma, booksRoot, OWNER, bookAId)).not.toBeNull();
    expect(await getBookById(prisma, booksRoot, OWNER, bookBId)).not.toBeNull();
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

    vi.mocked(parseEpub).mockImplementationOnce(() => ({
      ...FAKE_META,
      title: 'Dune Messiah',
      series: 'Dune',
      subjects: ['Science Fiction', 'Politics'],
      pageCount: 200,
    }));
    vi.mocked(partialMD5).mockImplementationOnce(() => 'b1');

    await bookStore.reimportBook(OWNER, 'b1');

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
    vi.mocked(parseEpub).mockImplementationOnce(() => ({
      ...FAKE_META,
      title: 'New Book',
      series: 'New Series',
      subjects: ['Horror'],
      pageCount: 80,
    }));
    vi.mocked(partialMD5).mockImplementationOnce(() => 'b1');

    await bookStore.reimportBook(OWNER, 'b1');

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

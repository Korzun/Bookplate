import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import AdmZip from 'adm-zip';
import { BookStore, BookHashCollisionError, ScanImporter } from './book-store';
import { partialMD5 } from './epub-parser';
import { EpubMeta } from '../types';
import { runMigrations } from '../db/migrate';

jest.mock('../logger');

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

const FAKE_META: EpubMeta = {
  title: 'Test Book',
  author: 'Author Name',
  description: 'A test description',
  publisher: 'Test Publisher',
  series: 'Test Series',
  seriesIndex: 1,
  fileAs: '',
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
let booksDir: string;
let bookStore: BookStore;
let dbPath: string;

beforeEach(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'books-test-'));
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
  bookStore = new BookStore(booksDir, prisma);
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

describe('addBook and listBooks', () => {
  it('inserts a book and lists it', async () => {
    await bookStore.addBook('abc123', stage('abc123'), FAKE_META);
    const books = await bookStore.listBooks();
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
    await bookStore.addBook('same-id', aPath, FAKE_META);
    await expect(bookStore.addBook('same-id', bPath, FAKE_META)).rejects.toThrow(
      'Book with id "same-id" already exists'
    );
  });

  it('moves the source file to <booksDir>/<id>.epub', async () => {
    const stagedPath = path.join(booksDir, 'staged.epub');
    fs.writeFileSync(stagedPath, 'content');
    await bookStore.addBook('move-id', stagedPath, FAKE_META);
    expect(fs.existsSync(stagedPath)).toBe(false);
    expect(fs.existsSync(path.join(booksDir, 'move-id.epub'))).toBe(true);
  });

  it('is a no-op for the file when source is already at <id>.epub', async () => {
    const canonical = path.join(booksDir, 'noop-id.epub');
    fs.writeFileSync(canonical, 'content');
    await bookStore.addBook('noop-id', canonical, FAKE_META);
    expect(fs.existsSync(canonical)).toBe(true);
    expect(fs.readFileSync(canonical, 'utf8')).toBe('content');
  });

  it('records size and mtime by stat-ing the source file', async () => {
    const stagedPath = path.join(booksDir, 'sized.epub');
    fs.writeFileSync(stagedPath, '0123456789');
    await bookStore.addBook('size-id', stagedPath, FAKE_META);
    const book = await bookStore.getBookById('size-id');
    expect(book!.size).toBe(10);
    expect(Math.abs(book!.mtime.getTime() - Date.now())).toBeLessThan(5000);
  });

  it('sorts by title', async () => {
    await bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      title: 'Zebra',
    });
    await bookStore.addBook('id2', stage('id2'), {
      ...FAKE_META,
      title: 'Apple',
    });
    const books = await bookStore.listBooks();
    expect(books[0].title).toBe('Apple');
    expect(books[1].title).toBe('Zebra');
  });

  it('returns hasCover false when no cover', async () => {
    await bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    const books = await bookStore.listBooks();
    expect(books[0].hasCover).toBe(false);
  });

  it('persists fileAs on stored books', async () => {
    await bookStore.addBook('abc123', stage('abc123'), {
      ...FAKE_META,
      fileAs: 'Asimov, Isaac',
    });

    const book = await bookStore.getBookById('abc123');

    expect(book!.fileAs).toBe('Asimov, Isaac');
  });

  it('stores trimmed fileAs even when metadata has extra whitespace', async () => {
    await bookStore.addBook('trim1', stage('trim1'), {
      ...FAKE_META,
      fileAs: '  Asimov, Isaac  ',
    });

    const book = await bookStore.getBookById('trim1');
    expect(book!.fileAs).toBe('Asimov, Isaac');
  });

  it('sorts by fileAs before title', async () => {
    await bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      title: 'Zebra Stories',
      fileAs: 'Apple, A.',
    });
    await bookStore.addBook('id2', stage('id2'), {
      ...FAKE_META,
      title: 'Apple Stories',
      fileAs: 'Zulu, Z.',
    });

    const books = await bookStore.listBooks();

    expect(books[0].title).toBe('Zebra Stories');
    expect(books[1].title).toBe('Apple Stories');
  });

  it('falls back to title when fileAs is empty', async () => {
    await bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      title: 'Bravo',
      fileAs: '',
    });
    await bookStore.addBook('id2', stage('id2'), {
      ...FAKE_META,
      title: 'Alpha',
      fileAs: '',
    });

    const books = await bookStore.listBooks();

    expect(books[0].title).toBe('Alpha');
    expect(books[1].title).toBe('Bravo');
  });

  it('stores and retrieves chapterNames (JSON round-trip)', async () => {
    await bookStore.addBook('ch1', stage('ch1'), {
      ...FAKE_META,
      chapterCount: 2,
      chapterSpineMap: [1, 2],
      chapterNames: ['The Storm', 'The Calm'],
    });
    const book = await bookStore.getBookById('ch1');
    expect(book?.chapterNames).toEqual(['The Storm', 'The Calm']);
  });

  it('returns empty chapterNames array when column is NULL (pre-migration books)', async () => {
    // Simulate a book inserted without chapter_names (NULL default)
    await prisma.$executeRawUnsafe(
      `INSERT INTO books (id, title, size, mtime, added_at, chapter_count, chapter_spine_map) VALUES ('old-book', 'Old Book', 100, 0, 0, 0, '[]')`
    );
    const book = await bookStore.getBookById('old-book');
    expect(book?.chapterNames).toEqual([]);
  });

  it('exposes book.filename as the computed download name', async () => {
    await bookStore.addBook('fname-1', stage('fname-1'), {
      ...FAKE_META,
      author: 'Frank Herbert',
      series: '',
      seriesIndex: 0,
      title: 'Dune',
    });
    const book = await bookStore.getBookById('fname-1');
    expect(book!.filename).toBe('Frank_Herbert-Dune.epub');
  });

  it('exposes book.path as <booksDir>/<id>.epub regardless of stored path', async () => {
    await bookStore.addBook('path-1', stage('path-1'), FAKE_META);
    const book = await bookStore.getBookById('path-1');
    expect(book!.path).toBe(path.join(booksDir, 'path-1.epub'));
  });
});

describe('getBookById', () => {
  it('returns the book by id', async () => {
    await bookStore.addBook('myid', stage('myid'), FAKE_META);
    const book = await bookStore.getBookById('myid');
    expect(book).not.toBeNull();
    expect(book!.filename).toBe('Author_Name-Test_Series-1-Test_Book.epub');
  });

  it('returns null for unknown id', async () => {
    expect(await bookStore.getBookById('unknown')).toBeNull();
  });
});

describe('deleteBook', () => {
  it('removes book from db and returns it', async () => {
    await bookStore.addBook('del1', stage('del1'), FAKE_META);
    const deleted = await bookStore.deleteBook('del1');
    expect(deleted).not.toBeNull();
    expect(deleted!.id).toBe('del1');
    expect(await bookStore.listBooks()).toHaveLength(0);
  });

  it('returns null for unknown id', async () => {
    expect(await bookStore.deleteBook('nope')).toBeNull();
  });

  it('removes book_id_history entries for the deleted book', async () => {
    await bookStore.addBook('del2', stage('del2'), FAKE_META);
    await prisma.$executeRaw`
      INSERT INTO book_id_history (old_id, current_id) VALUES ('old-del2', 'del2')
    `;
    await bookStore.deleteBook('del2');
    const rows = await prisma.$queryRaw<Array<unknown>>`
      SELECT * FROM book_id_history WHERE old_id = 'old-del2' OR current_id = 'del2'
    `;
    expect(rows).toHaveLength(0);
  });
});

describe('getCover', () => {
  it('returns cover data and mime', async () => {
    await bookStore.addBook('cov1', stage('cov1'), FAKE_META);
    const cover = await bookStore.getCover('cov1');
    expect(cover).not.toBeNull();
    expect(Buffer.from(cover!.data)).toEqual(Buffer.from('fake-cover'));
    expect(cover!.mime).toBe('image/jpeg');
  });

  it('returns null when no cover', async () => {
    await bookStore.addBook('nocov', stage('nocov'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    expect(await bookStore.getCover('nocov')).toBeNull();
  });

  it('returns null for unknown id', async () => {
    expect(await bookStore.getCover('unknown')).toBeNull();
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
      fileAs: '',
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
    const result = await bookStore.scan(makeMockImporter());
    expect(result).toEqual({ imported: [], removed: [] });
  });

  it('imports an epub found on disk but not in DB', async () => {
    const filePath = path.join(booksDir, 'new-book.epub');
    fs.writeFileSync(filePath, 'fake-epub-content');
    const result = await bookStore.scan(makeMockImporter());
    expect(result.imported).toEqual(['new-book.epub']);
    expect(result.removed).toEqual([]);
    const books = await bookStore.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe('Mock Title');
  });

  it('does not re-import a book already in the DB', async () => {
    const filePath = path.join(booksDir, 'existing.epub');
    fs.writeFileSync(filePath, 'fake-epub-content');
    await bookStore.scan(makeMockImporter()); // first scan imports it
    const result = await bookStore.scan(makeMockImporter()); // second scan is a no-op
    expect(result.imported).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(await bookStore.listBooks()).toHaveLength(1);
  });

  it('removes a stale DB entry whose file no longer exists on disk', async () => {
    // Add the book with a real file, then delete the file to simulate a stale DB entry
    const ghostStagedPath = stage('ghostid001');
    await bookStore.addBook('ghostid001', ghostStagedPath, {
      title: 'Ghost Book',
      author: '',
      description: '',
      publisher: '',
      series: '',
      seriesIndex: 0,
      fileAs: '',
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
    expect(await bookStore.listBooks()).toHaveLength(1);
    const result = await bookStore.scan(makeMockImporter());
    expect(result.removed).toEqual(['ghostid001.epub']);
    expect(result.imported).toEqual([]);
    expect(await bookStore.listBooks()).toHaveLength(0);
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
          fileAs: '',
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
    const result = await bookStore.scan(errorImporter);
    expect(result.imported).toHaveLength(1);
    expect(result.imported).toContain('good.epub');
    expect(result.removed).toEqual([]);
  });

  it('ignores non-epub files in booksDir', async () => {
    fs.writeFileSync(path.join(booksDir, 'readme.txt'), 'text');
    fs.writeFileSync(path.join(booksDir, 'book.epub'), 'epub');
    const result = await bookStore.scan(makeMockImporter());
    expect(result.imported).toEqual(['book.epub']);
  });

  it('renames a non-canonically-named file to <id>.epub before importing', async () => {
    const arbitraryPath = path.join(booksDir, 'arbitrary-name.epub');
    fs.writeFileSync(arbitraryPath, makeMinimalEpub('A Book'));
    const importer = makeMockImporter();
    const result = await bookStore.scan(importer);
    expect(result.imported).toContain('arbitrary-name.epub');
    expect(fs.existsSync(arbitraryPath)).toBe(false);
    const books = await bookStore.listBooks();
    expect(books).toHaveLength(1);
    const expectedPath = path.join(booksDir, books[0].id + '.epub');
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it('removes rows whose canonical file is missing', async () => {
    const id = 'orphan-id-123';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, makeMinimalEpub('To Delete'));
    await bookStore.addBook(id, filePath, FAKE_META);
    fs.unlinkSync(filePath);

    const result = await bookStore.scan(makeMockImporter());
    expect(result.removed).toContain(id + '.epub');
    expect(await bookStore.getBookById(id)).toBeNull();
  });

  it('skips canonically-named files already in the DB without calling partialMD5', async () => {
    // Set up: a book exists at <id>.epub with id in DB.
    const id = 'a1b2c3d4e5f6789012345678901234ab';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, makeMinimalEpub('Already Here'));
    await bookStore.addBook(id, filePath, FAKE_META);

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
    const result = await bookStore.scan(importer);
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
    await bookStore.addBook('id1', stage('id1'), FAKE_META);
    const book = await bookStore.getBookById('id1');
    expect(book?.publisher).toBe('Test Publisher');
  });

  it('stores and retrieves identifiers (JSON round-trip)', async () => {
    await bookStore.addBook('id1', stage('id1'), FAKE_META);
    const book = await bookStore.getBookById('id1');
    expect(book?.identifiers).toEqual([{ scheme: 'ISBN', value: '978-0000000000' }]);
  });

  it('stores and retrieves subjects (JSON round-trip)', async () => {
    await bookStore.addBook('id1', stage('id1'), FAKE_META);
    const book = await bookStore.getBookById('id1');
    expect(book?.subjects).toEqual(['Fiction']);
  });

  it('stores empty identifiers as empty array', async () => {
    await bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      identifiers: [],
    });
    const book = await bookStore.getBookById('id1');
    expect(book?.identifiers).toEqual([]);
  });

  it('stores empty subjects as empty array', async () => {
    await bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      subjects: [],
    });
    const book = await bookStore.getBookById('id1');
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
    await bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      chapterCount: 12,
      chapterSpineMap: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
    const book = await bookStore.getBookById('id1');
    expect(book?.chapterCount).toBe(12);
  });

  it('stores and retrieves chapterSpineMap (JSON round-trip)', async () => {
    const spineMap = [2, 4, 6, 8];
    await bookStore.addBook('id2', stage('id2'), {
      ...FAKE_META,
      chapterCount: 4,
      chapterSpineMap: spineMap,
    });
    const book = await bookStore.getBookById('id2');
    expect(book?.chapterSpineMap).toEqual(spineMap);
  });

  it('defaults to chapterCount 0 and empty chapterSpineMap', async () => {
    await bookStore.addBook('id3', stage('id3'), FAKE_META);
    const book = await bookStore.getBookById('id3');
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
    await bookStore.addBook('id1', stage('id1'), { ...FAKE_META, pageCount: 42 });
    expect((await bookStore.getBookById('id1'))?.pageCount).toBe(42);
  });

  it('defaults to 0 when pageCount is not set', async () => {
    await bookStore.addBook('id2', stage('id2'), { ...FAKE_META, pageCount: 0 });
    expect((await bookStore.getBookById('id2'))?.pageCount).toBe(0);
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
    await migPrisma.$executeRaw`INSERT INTO books (id, filename, path, title, size, mtime, added_at) VALUES (${staleId}, 'migrate-v2.epub', ${filePath}, 'Test', 2048, 0, 0)`;

    await runMigrations(migPrisma, booksDir);

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
      CREATE TABLE progress (
        username TEXT NOT NULL, document TEXT NOT NULL, progress TEXT NOT NULL,
        percentage REAL NOT NULL, device TEXT NOT NULL, device_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL, PRIMARY KEY (username, document)
      )
    `);
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
    expect(await bookStore.reimportBook('doesnotexist')).toBeNull();
  });

  it('re-reads metadata from disk and updates the DB row', async () => {
    const epubBuf = makeMinimalEpub('Original');
    const stagedPath = path.join(booksDir, 'staged-original.epub');
    fs.writeFileSync(stagedPath, epubBuf);
    const id = partialMD5(stagedPath);
    await bookStore.addBook(id, stagedPath, {
      ...FAKE_META,
      title: 'Original',
    });

    // The file is now at <booksDir>/<id>.epub — overwrite it with new title
    const canonicalPath = path.join(booksDir, id + '.epub');
    const updatedBuf = makeMinimalEpub('Updated');
    fs.writeFileSync(canonicalPath, updatedBuf);

    const updated = await bookStore.reimportBook(id);
    // ID may have changed due to ZIP rewrite — updated reflects new state
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('Updated');
  });

  it('cascades id change to progress table when partial MD5 shifts', async () => {
    const epubBuf = makeMinimalEpub('Before');
    const stagedPath = path.join(booksDir, 'staged-cascade.epub');
    fs.writeFileSync(stagedPath, epubBuf);
    const oldId = partialMD5(stagedPath);
    await bookStore.addBook(oldId, stagedPath, FAKE_META);
    const epubPath = path.join(booksDir, oldId + '.epub');

    // Insert a progress record for the old ID using the shared prisma client
    await prisma.user.create({ data: { username: 'alice', key: 'k' } });
    await prisma.progress.create({
      data: {
        username: 'alice',
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

    const updated = await bookStore.reimportBook(oldId);
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
    expect(await bookStore.getBookById(newId)).not.toBeNull();
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
    await bookStore.addBook(oldId, epubPath, FAKE_META);

    // Orphaned progress under newId (no book owns newId)
    await prisma.user.create({ data: { username: 'alice', key: 'k' } });
    await prisma.progress.create({
      data: {
        username: 'alice',
        document: newId,
        progress: '/p[2]',
        percentage: 0.8,
        device: 'Kobo',
        deviceId: 'd1',
        timestamp: 2000,
      },
    });

    const mockImporter = { parseEpub: () => FAKE_META, partialMD5: () => newId };
    const result = await bookStore.reimportBook(oldId, mockImporter);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(newId);
    // Orphaned progress is now owned by the book
    const newRows = await prisma.progress.findMany({ where: { document: newId } });
    expect(newRows).toHaveLength(1);
    expect(newRows[0].username).toBe('alice');
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
    await bookStore.addBook(oldId, epubPath, FAKE_META);

    // alice: current progress is newer (ts=3000) than orphaned (ts=1000) → current wins
    await prisma.user.create({ data: { username: 'alice', key: 'k' } });
    await prisma.user.create({ data: { username: 'bob', key: 'k' } });
    await prisma.progress.create({
      data: {
        username: 'alice',
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
        username: 'alice',
        document: newId,
        progress: '/p[2]',
        percentage: 0.4,
        device: 'Kobo',
        deviceId: 'd1',
        timestamp: 1000,
      },
    });
    // bob: orphaned progress is newer (ts=5000) than current (ts=2000) → orphaned wins
    await prisma.progress.create({
      data: {
        username: 'bob',
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
        username: 'bob',
        document: newId,
        progress: '/p[9]',
        percentage: 0.95,
        device: 'Kobo',
        deviceId: 'd2',
        timestamp: 5000,
      },
    });

    const mockImporter = { parseEpub: () => FAKE_META, partialMD5: () => newId };
    await bookStore.reimportBook(oldId, mockImporter);

    const aliceRows = await prisma.progress.findMany({
      where: { username: 'alice', document: newId },
    });
    expect(aliceRows).toHaveLength(1);
    expect(aliceRows[0].progress).toBe('/p[5]'); // alice's newer current record won
    expect(aliceRows[0].timestamp).toBe(3000);

    const bobRows = await prisma.progress.findMany({ where: { username: 'bob', document: newId } });
    expect(bobRows).toHaveLength(1);
    expect(bobRows[0].progress).toBe('/p[9]'); // bob's newer orphaned record won
    expect(bobRows[0].timestamp).toBe(5000);

    // No records left under oldId
    const oldIdCount = await prisma.progress.count({ where: { document: oldId } });
    expect(oldIdCount).toBe(0);
  });
});

describe('book_thumbnails', () => {
  it('saveThumbnail stores and getThumbnail retrieves', async () => {
    await bookStore.addBook('bk1', stage('bk1'), FAKE_META);
    const data = Buffer.from('thumb-data');
    await bookStore.saveThumbnail('bk1', 150, data, 'image/jpeg');
    const result = await bookStore.getThumbnail('bk1', 150);
    expect(result).not.toBeNull();
    expect(Buffer.from(result!.data).toString()).toBe('thumb-data');
    expect(result!.mime).toBe('image/jpeg');
  });

  it('getThumbnail returns null when not present', async () => {
    await bookStore.addBook('bk2', stage('bk2'), FAKE_META);
    expect(await bookStore.getThumbnail('bk2', 150)).toBeNull();
  });

  it('saveThumbnail upserts on (book_id, width) conflict', async () => {
    await bookStore.addBook('bk3', stage('bk3'), FAKE_META);
    await bookStore.saveThumbnail('bk3', 150, Buffer.from('v1'), 'image/jpeg');
    await bookStore.saveThumbnail('bk3', 150, Buffer.from('v2'), 'image/jpeg');
    expect(Buffer.from((await bookStore.getThumbnail('bk3', 150))!.data).toString()).toBe('v2');
  });

  it('pruneThumbnails removes rows whose width is not in the config list', async () => {
    await bookStore.addBook('bk4', stage('bk4'), FAKE_META);
    await bookStore.saveThumbnail('bk4', 60, Buffer.from('x'), 'image/jpeg');
    await bookStore.saveThumbnail('bk4', 150, Buffer.from('y'), 'image/jpeg');
    await bookStore.saveThumbnail('bk4', 300, Buffer.from('z'), 'image/jpeg');
    const removed = await bookStore.pruneThumbnails([60, 150]);
    expect(removed).toBe(1);
    expect(await bookStore.getThumbnail('bk4', 60)).not.toBeNull();
    expect(await bookStore.getThumbnail('bk4', 150)).not.toBeNull();
    expect(await bookStore.getThumbnail('bk4', 300)).toBeNull();
  });

  it('pruneThumbnails with empty array removes all thumbnails', async () => {
    await bookStore.addBook('bk5', stage('bk5'), FAKE_META);
    await bookStore.saveThumbnail('bk5', 60, Buffer.from('x'), 'image/jpeg');
    const removed = await bookStore.pruneThumbnails([]);
    expect(removed).toBe(1);
  });

  it('getMissingThumbnailPairs returns pairs without thumbnails', async () => {
    const metaWithCover = {
      ...FAKE_META,
      coverData: Buffer.from('cover'),
      coverMime: 'image/jpeg',
    };
    await bookStore.addBook('bk6', stage('bk6'), metaWithCover);
    await bookStore.addBook('bk7', stage('bk7'), metaWithCover);
    await bookStore.saveThumbnail('bk6', 60, Buffer.from('x'), 'image/jpeg'); // already has 60px

    const missing = await bookStore.getMissingThumbnailPairs([60, 170]);
    // bk6 needs 170, bk7 needs both
    expect(missing).toContainEqual({ bookId: 'bk6', width: 170 });
    expect(missing).toContainEqual({ bookId: 'bk7', width: 60 });
    expect(missing).toContainEqual({ bookId: 'bk7', width: 170 });
    expect(missing).not.toContainEqual({ bookId: 'bk6', width: 60 });
  });

  it('getMissingThumbnailPairs ignores books without covers', async () => {
    await bookStore.addBook('bk8', stage('bk8'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    const missing = await bookStore.getMissingThumbnailPairs([60]);
    expect(missing.map((p) => p.bookId)).not.toContain('bk8');
  });

  it('deleting a book cascades to book_thumbnails', async () => {
    await bookStore.addBook('bk9', stage('bk9'), FAKE_META);
    await bookStore.saveThumbnail('bk9', 60, Buffer.from('x'), 'image/jpeg');
    await bookStore.deleteBook('bk9');
    expect(await bookStore.getThumbnail('bk9', 60)).toBeNull();
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
    await bookStore.addBook(originalId, epubPath, FAKE_META);
    await bookStore.saveThumbnail(originalId, 60, Buffer.from('thumb'), 'image/jpeg');

    const mockImporter = {
      parseEpub: () => FAKE_META,
      partialMD5: () => newId,
    };
    await bookStore.reimportBook(originalId, mockImporter);

    // Thumbnail should now be under new ID (not lost, not causing FK error)
    expect(await bookStore.getThumbnail(newId, 60)).not.toBeNull();
    expect(await bookStore.getThumbnail(originalId, 60)).toBeNull();
  });

  it('renames file on disk from <oldId>.epub to <newId>.epub when hash changes', async () => {
    const oldId = 'old-id-aaaa';
    const oldPath = path.join(booksDir, oldId + '.epub');
    fs.writeFileSync(oldPath, 'epub-bytes');
    await bookStore.addBook(oldId, oldPath, FAKE_META);

    const newId = 'new-id-bbbb';
    const mockImporter: ScanImporter = {
      parseEpub: () => ({ ...FAKE_META, title: 'New Title' }),
      partialMD5: () => newId,
    };
    await bookStore.reimportBook(oldId, mockImporter);

    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(path.join(booksDir, newId + '.epub'))).toBe(true);
  });

  it('does not rename when hash is unchanged', async () => {
    const id = 'stable-id';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, 'epub-bytes');
    await bookStore.addBook(id, filePath, FAKE_META);

    const mockImporter: ScanImporter = {
      parseEpub: () => ({ ...FAKE_META, title: 'Edited' }),
      partialMD5: () => id,
    };
    await bookStore.reimportBook(id, mockImporter);

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
    await bookStore.addBook(bookAId, epubPath, FAKE_META);
    await bookStore.addBook(bookBId, stage('book-b-id'), FAKE_META);

    // Mock importer returns bookBId as the new hash — collision with existing book
    const mockImporter = {
      parseEpub: () => FAKE_META,
      partialMD5: () => bookBId,
    };

    await expect(bookStore.reimportBook(bookAId, mockImporter)).rejects.toThrow(
      BookHashCollisionError
    );
    // Both books must remain intact after the failed reimport
    expect(await bookStore.getBookById(bookAId)).not.toBeNull();
    expect(await bookStore.getBookById(bookBId)).not.toBeNull();
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
    expect(await bookStore.resolveBookId('unknown-id')).toBe('unknown-id');
  });

  it('resolveBookId returns current_id when a mapping exists', async () => {
    await prisma.$executeRaw`
      INSERT INTO book_id_history (old_id, current_id) VALUES ('old-id', 'new-id')
    `;
    expect(await bookStore.resolveBookId('old-id')).toBe('new-id');
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
    await bookStore.addBook('id-a', stagedPath, FAKE_META);
    await bookStore.reimportBook('id-a', makeImporterWithId('id-b'));
    expect(await bookStore.resolveBookId('id-a')).toBe('id-b');
  });

  it('multi-hop: resolveBookId(original) returns latest after two reimports', async () => {
    const stagedPath = stage('lineage-multi');
    await bookStore.addBook('id-a', stagedPath, FAKE_META);
    // First hop: id-a → id-b
    await bookStore.reimportBook('id-a', makeImporterWithId('id-b'));
    // Write a file at id-b so reimportBook can stat it
    fs.writeFileSync(path.join(booksDir, 'id-b.epub'), 'epub-content');
    // Second hop: id-b → id-c (also flattens id-a → id-c)
    await bookStore.reimportBook('id-b', makeImporterWithId('id-c'));
    expect(await bookStore.resolveBookId('id-a')).toBe('id-c');
    expect(await bookStore.resolveBookId('id-b')).toBe('id-c');
  });

  it('no history entry when ID does not change on reimport', async () => {
    const stagedPath = stage('lineage-noop');
    await bookStore.addBook('id-a', stagedPath, FAKE_META);
    await bookStore.reimportBook('id-a', makeImporterWithId('id-a'));
    expect(await bookStore.resolveBookId('id-a')).toBe('id-a');
    const rows = await prisma.$queryRaw<Array<unknown>>`
      SELECT * FROM book_id_history WHERE old_id = 'id-a'
    `;
    expect(rows).toHaveLength(0);
  });
});

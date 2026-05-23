import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import { BookStore, BookHashCollisionError, ScanImporter } from './book-store';
import { partialMD5 } from './epub-parser';
import { EpubMeta } from '../types';

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

let db: InstanceType<typeof Database>;
let booksDir: string;
let bookStore: BookStore;

beforeEach(() => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'books-test-'));
  db = new Database(':memory:');
  bookStore = new BookStore(booksDir, db);
});

afterEach(() => {
  db.close();
  fs.rmSync(booksDir, { recursive: true });
});

describe('addBook and listBooks', () => {
  it('inserts a book and lists it', () => {
    bookStore.addBook('abc123', stage('abc123'), FAKE_META);
    const books = bookStore.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0].id).toBe('abc123');
    expect(books[0].title).toBe('Test Book');
    expect(books[0].author).toBe('Author Name');
    expect(books[0].hasCover).toBe(true);
  });

  it('throws BookAlreadyExistsError when adding a book whose id is already in the DB', () => {
    const aPath = path.join(booksDir, 'a.epub');
    const bPath = path.join(booksDir, 'b.epub');
    fs.writeFileSync(aPath, 'first');
    fs.writeFileSync(bPath, 'second');
    bookStore.addBook('same-id', aPath, FAKE_META);
    expect(() => bookStore.addBook('same-id', bPath, FAKE_META)).toThrow(
      'Book with id "same-id" already exists'
    );
  });

  it('moves the source file to <booksDir>/<id>.epub', () => {
    const stagedPath = path.join(booksDir, 'staged.epub');
    fs.writeFileSync(stagedPath, 'content');
    bookStore.addBook('move-id', stagedPath, FAKE_META);
    expect(fs.existsSync(stagedPath)).toBe(false);
    expect(fs.existsSync(path.join(booksDir, 'move-id.epub'))).toBe(true);
  });

  it('is a no-op for the file when source is already at <id>.epub', () => {
    const canonical = path.join(booksDir, 'noop-id.epub');
    fs.writeFileSync(canonical, 'content');
    bookStore.addBook('noop-id', canonical, FAKE_META);
    expect(fs.existsSync(canonical)).toBe(true);
    expect(fs.readFileSync(canonical, 'utf8')).toBe('content');
  });

  it('records size and mtime by stat-ing the source file', () => {
    const stagedPath = path.join(booksDir, 'sized.epub');
    fs.writeFileSync(stagedPath, '0123456789');
    bookStore.addBook('size-id', stagedPath, FAKE_META);
    const book = bookStore.getBookById('size-id');
    expect(book!.size).toBe(10);
    expect(Math.abs(book!.mtime.getTime() - Date.now())).toBeLessThan(5000);
  });

  it('sorts by title', () => {
    bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      title: 'Zebra',
    });
    bookStore.addBook('id2', stage('id2'), {
      ...FAKE_META,
      title: 'Apple',
    });
    const books = bookStore.listBooks();
    expect(books[0].title).toBe('Apple');
    expect(books[1].title).toBe('Zebra');
  });

  it('returns hasCover false when no cover', () => {
    bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    const books = bookStore.listBooks();
    expect(books[0].hasCover).toBe(false);
  });

  it('persists fileAs on stored books', () => {
    bookStore.addBook('abc123', stage('abc123'), {
      ...FAKE_META,
      fileAs: 'Asimov, Isaac',
    });

    const book = bookStore.getBookById('abc123');

    expect(book!.fileAs).toBe('Asimov, Isaac');
  });

  it('stores trimmed fileAs even when metadata has extra whitespace', () => {
    bookStore.addBook('trim1', stage('trim1'), {
      ...FAKE_META,
      fileAs: '  Asimov, Isaac  ',
    });

    const book = bookStore.getBookById('trim1');
    expect(book!.fileAs).toBe('Asimov, Isaac');
  });

  it('sorts by fileAs before title', () => {
    bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      title: 'Zebra Stories',
      fileAs: 'Apple, A.',
    });
    bookStore.addBook('id2', stage('id2'), {
      ...FAKE_META,
      title: 'Apple Stories',
      fileAs: 'Zulu, Z.',
    });

    const books = bookStore.listBooks();

    expect(books[0].title).toBe('Zebra Stories');
    expect(books[1].title).toBe('Apple Stories');
  });

  it('falls back to title when fileAs is empty', () => {
    bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      title: 'Bravo',
      fileAs: '',
    });
    bookStore.addBook('id2', stage('id2'), {
      ...FAKE_META,
      title: 'Alpha',
      fileAs: '',
    });

    const books = bookStore.listBooks();

    expect(books[0].title).toBe('Alpha');
    expect(books[1].title).toBe('Bravo');
  });

  it('stores and retrieves chapterNames (JSON round-trip)', () => {
    bookStore.addBook('ch1', stage('ch1'), {
      ...FAKE_META,
      chapterCount: 2,
      chapterSpineMap: [1, 2],
      chapterNames: ['The Storm', 'The Calm'],
    });
    const book = bookStore.getBookById('ch1');
    expect(book?.chapterNames).toEqual(['The Storm', 'The Calm']);
  });

  it('returns empty chapterNames array when column is NULL (pre-migration books)', () => {
    // Simulate a book inserted without chapter_names (NULL default)
    db.prepare(
      `INSERT INTO books (id, title, size, mtime, added_at, chapter_count, chapter_spine_map)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('old-book', 'Old Book', 100, 0, 0, 0, '[]');
    const book = bookStore.getBookById('old-book');
    expect(book?.chapterNames).toEqual([]);
  });

  it('exposes book.filename as the computed download name', () => {
    bookStore.addBook('fname-1', stage('fname-1'), {
      ...FAKE_META,
      author: 'Frank Herbert',
      series: '',
      seriesIndex: 0,
      title: 'Dune',
    });
    const book = bookStore.getBookById('fname-1');
    expect(book!.filename).toBe('Frank_Herbert-Dune.epub');
  });

  it('exposes book.path as <booksDir>/<id>.epub regardless of stored path', () => {
    bookStore.addBook('path-1', stage('path-1'), FAKE_META);
    const book = bookStore.getBookById('path-1');
    expect(book!.path).toBe(path.join(booksDir, 'path-1.epub'));
  });
});

describe('getBookById', () => {
  it('returns the book by id', () => {
    bookStore.addBook('myid', stage('myid'), FAKE_META);
    const book = bookStore.getBookById('myid');
    expect(book).not.toBeNull();
    expect(book!.filename).toBe('Author_Name-Test_Series-1-Test_Book.epub');
  });

  it('returns null for unknown id', () => {
    expect(bookStore.getBookById('unknown')).toBeNull();
  });
});

describe('deleteBook', () => {
  it('removes book from db and returns it', () => {
    bookStore.addBook('del1', stage('del1'), FAKE_META);
    const deleted = bookStore.deleteBook('del1');
    expect(deleted).not.toBeNull();
    expect(deleted!.id).toBe('del1');
    expect(bookStore.listBooks()).toHaveLength(0);
  });

  it('returns null for unknown id', () => {
    expect(bookStore.deleteBook('nope')).toBeNull();
  });
});

describe('getCover', () => {
  it('returns cover data and mime', () => {
    bookStore.addBook('cov1', stage('cov1'), FAKE_META);
    const cover = bookStore.getCover('cov1');
    expect(cover).not.toBeNull();
    expect(cover!.data).toEqual(Buffer.from('fake-cover'));
    expect(cover!.mime).toBe('image/jpeg');
  });

  it('returns null when no cover', () => {
    bookStore.addBook('nocov', stage('nocov'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    expect(bookStore.getCover('nocov')).toBeNull();
  });

  it('returns null for unknown id', () => {
    expect(bookStore.getCover('unknown')).toBeNull();
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
  it('returns empty lists when booksDir is empty and DB is empty', () => {
    const result = bookStore.scan(makeMockImporter());
    expect(result).toEqual({ imported: [], removed: [] });
  });

  it('imports an epub found on disk but not in DB', () => {
    const filePath = path.join(booksDir, 'new-book.epub');
    fs.writeFileSync(filePath, 'fake-epub-content');
    const result = bookStore.scan(makeMockImporter());
    expect(result.imported).toEqual(['new-book.epub']);
    expect(result.removed).toEqual([]);
    const books = bookStore.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe('Mock Title');
  });

  it('does not re-import a book already in the DB', () => {
    const filePath = path.join(booksDir, 'existing.epub');
    fs.writeFileSync(filePath, 'fake-epub-content');
    bookStore.scan(makeMockImporter()); // first scan imports it
    const result = bookStore.scan(makeMockImporter()); // second scan is a no-op
    expect(result.imported).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(bookStore.listBooks()).toHaveLength(1);
  });

  it('removes a stale DB entry whose file no longer exists on disk', () => {
    // Add the book with a real file, then delete the file to simulate a stale DB entry
    const ghostStagedPath = stage('ghostid001');
    bookStore.addBook('ghostid001', ghostStagedPath, {
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
    expect(bookStore.listBooks()).toHaveLength(1);
    const result = bookStore.scan(makeMockImporter());
    expect(result.removed).toEqual(['ghostid001.epub']);
    expect(result.imported).toEqual([]);
    expect(bookStore.listBooks()).toHaveLength(0);
  });

  it('skips a file that fails to parse and continues scanning others', () => {
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
    const result = bookStore.scan(errorImporter);
    expect(result.imported).toHaveLength(1);
    expect(result.imported).toContain('good.epub');
    expect(result.removed).toEqual([]);
  });

  it('ignores non-epub files in booksDir', () => {
    fs.writeFileSync(path.join(booksDir, 'readme.txt'), 'text');
    fs.writeFileSync(path.join(booksDir, 'book.epub'), 'epub');
    const result = bookStore.scan(makeMockImporter());
    expect(result.imported).toEqual(['book.epub']);
  });

  it('renames a non-canonically-named file to <id>.epub before importing', () => {
    const arbitraryPath = path.join(booksDir, 'arbitrary-name.epub');
    fs.writeFileSync(arbitraryPath, makeMinimalEpub('A Book'));
    const importer = makeMockImporter();
    const result = bookStore.scan(importer);
    expect(result.imported).toContain('arbitrary-name.epub');
    expect(fs.existsSync(arbitraryPath)).toBe(false);
    const books = bookStore.listBooks();
    expect(books).toHaveLength(1);
    const expectedPath = path.join(booksDir, books[0].id + '.epub');
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it('removes rows whose canonical file is missing', () => {
    const id = 'orphan-id-123';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, makeMinimalEpub('To Delete'));
    bookStore.addBook(id, filePath, FAKE_META);
    fs.unlinkSync(filePath);

    const result = bookStore.scan(makeMockImporter());
    expect(result.removed).toContain(id + '.epub');
    expect(bookStore.getBookById(id)).toBeNull();
  });

  it('skips canonically-named files already in the DB without calling partialMD5', () => {
    // Set up: a book exists at <id>.epub with id in DB.
    const id = 'a1b2c3d4e5f6789012345678901234ab';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, makeMinimalEpub('Already Here'));
    bookStore.addBook(id, filePath, FAKE_META);

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
    const result = bookStore.scan(importer);
    expect(result.imported).toEqual([]);
    expect(mdCallCount).toBe(0);
  });
});

describe('publisher, identifiers, subjects', () => {
  it('DB migration adds publisher, identifiers, subjects columns', () => {
    const cols = db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('publisher');
    expect(names).toContain('identifiers');
    expect(names).toContain('subjects');
  });

  it('stores and retrieves publisher', () => {
    bookStore.addBook('id1', stage('id1'), FAKE_META);
    const book = bookStore.getBookById('id1');
    expect(book?.publisher).toBe('Test Publisher');
  });

  it('stores and retrieves identifiers (JSON round-trip)', () => {
    bookStore.addBook('id1', stage('id1'), FAKE_META);
    const book = bookStore.getBookById('id1');
    expect(book?.identifiers).toEqual([{ scheme: 'ISBN', value: '978-0000000000' }]);
  });

  it('stores and retrieves subjects (JSON round-trip)', () => {
    bookStore.addBook('id1', stage('id1'), FAKE_META);
    const book = bookStore.getBookById('id1');
    expect(book?.subjects).toEqual(['Fiction']);
  });

  it('stores empty identifiers as empty array', () => {
    bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      identifiers: [],
    });
    const book = bookStore.getBookById('id1');
    expect(book?.identifiers).toEqual([]);
  });

  it('stores empty subjects as empty array', () => {
    bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      subjects: [],
    });
    const book = bookStore.getBookById('id1');
    expect(book?.subjects).toEqual([]);
  });
});

describe('chapter data', () => {
  it('DB migration adds chapter_count and chapter_spine_map columns', () => {
    const cols = db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('chapter_count');
    expect(names).toContain('chapter_spine_map');
  });

  it('stores and retrieves chapterCount', () => {
    bookStore.addBook('id1', stage('id1'), {
      ...FAKE_META,
      chapterCount: 12,
      chapterSpineMap: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
    const book = bookStore.getBookById('id1');
    expect(book?.chapterCount).toBe(12);
  });

  it('stores and retrieves chapterSpineMap (JSON round-trip)', () => {
    const spineMap = [2, 4, 6, 8];
    bookStore.addBook('id2', stage('id2'), {
      ...FAKE_META,
      chapterCount: 4,
      chapterSpineMap: spineMap,
    });
    const book = bookStore.getBookById('id2');
    expect(book?.chapterSpineMap).toEqual(spineMap);
  });

  it('defaults to chapterCount 0 and empty chapterSpineMap', () => {
    bookStore.addBook('id3', stage('id3'), FAKE_META);
    const book = bookStore.getBookById('id3');
    expect(book?.chapterCount).toBe(0);
    expect(book?.chapterSpineMap).toEqual([]);
  });
});

describe('page count data', () => {
  it('DB migration adds page_count column', () => {
    const cols = db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('page_count');
  });

  it('stores and retrieves pageCount', () => {
    bookStore.addBook('id1', stage('id1'), { ...FAKE_META, pageCount: 42 });
    expect(bookStore.getBookById('id1')?.pageCount).toBe(42);
  });

  it('defaults to 0 when pageCount is not set', () => {
    bookStore.addBook('id2', stage('id2'), { ...FAKE_META, pageCount: 0 });
    expect(bookStore.getBookById('id2')?.pageCount).toBe(0);
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
  it('adds the file_as column when opening an existing books table', () => {
    const preexistingDb = new Database(':memory:');
    preexistingDb.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        series TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0,
        cover_data BLOB,
        cover_mime TEXT,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        added_at INTEGER NOT NULL
      )
    `);

    const migratedStore = new BookStore(booksDir, preexistingDb);
    const columns = preexistingDb.prepare('PRAGMA table_info(books)').all() as Array<{
      name: string;
    }>;

    expect(columns.some((column) => column.name === 'file_as')).toBe(true);
    expect(migratedStore.listBooks()).toEqual([]);

    preexistingDb.close();
  });

  it('migration v2: recomputes stale book ID to match corrected partial MD5', () => {
    const filePath = path.join(booksDir, 'migrate-v2.epub');
    fs.writeFileSync(filePath, Buffer.alloc(2048, 'x'));
    const correctId = partialMD5(filePath);
    const staleId = 'stale-id-from-old-algo';

    const preDb = new Database(':memory:');
    preDb.exec(BOOKS_SCHEMA);
    preDb
      .prepare(
        'INSERT INTO books (id, filename, path, title, size, mtime, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(staleId, 'migrate-v2.epub', filePath, 'Test', 2048, 0, 0);

    new BookStore(booksDir, preDb);

    const row = preDb.prepare('SELECT id FROM books').get() as { id: string };
    expect(row.id).toBe(correctId);
    expect(preDb.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 8 });

    preDb.close();
  });

  it('migration v2: also updates matching progress records', () => {
    const filePath = path.join(booksDir, 'migrate-v2-prog.epub');
    fs.writeFileSync(filePath, Buffer.alloc(2048, 'y'));
    const correctId = partialMD5(filePath);
    const staleId = 'stale-progress-id';

    const preDb = new Database(':memory:');
    preDb.exec(BOOKS_SCHEMA);
    preDb.exec(`
      CREATE TABLE progress (
        username TEXT NOT NULL, document TEXT NOT NULL, progress TEXT NOT NULL,
        percentage REAL NOT NULL, device TEXT NOT NULL, device_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL, PRIMARY KEY (username, document)
      )
    `);
    preDb
      .prepare(
        'INSERT INTO books (id, filename, path, title, size, mtime, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(staleId, 'migrate-v2-prog.epub', filePath, 'Test', 2048, 0, 0);
    preDb
      .prepare(
        'INSERT INTO progress (username, document, progress, percentage, device, device_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('alice', staleId, 'epub://', 0.5, 'Kobo', 'dev1', 1000);

    new BookStore(booksDir, preDb);

    const prog = preDb.prepare('SELECT document FROM progress').get() as { document: string };
    expect(prog.document).toBe(correctId);

    preDb.close();
  });

  it('migration v2: skips books whose files are missing', () => {
    const missingPath = path.join(booksDir, 'gone.epub');

    const preDb = new Database(':memory:');
    preDb.exec(BOOKS_SCHEMA);
    preDb
      .prepare(
        'INSERT INTO books (id, filename, path, title, size, mtime, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('some-id', 'gone.epub', missingPath, 'Gone', 100, 0, 0);

    // Should not throw; the book with the missing file keeps its old ID
    new BookStore(booksDir, preDb);

    const row = preDb.prepare('SELECT id FROM books').get() as { id: string };
    expect(row.id).toBe('some-id');

    preDb.close();
  });

  it('migration v2: does not re-run when user_version is already 2', () => {
    const filePath = path.join(booksDir, 'already-migrated.epub');
    fs.writeFileSync(filePath, Buffer.alloc(2048, 'z'));
    const pinnedId = 'pinned-id-should-not-change';

    const preDb = new Database(':memory:');
    preDb.exec(BOOKS_SCHEMA);
    preDb.exec('PRAGMA user_version = 2');
    preDb
      .prepare(
        'INSERT INTO books (id, filename, path, title, size, mtime, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(pinnedId, 'already-migrated.epub', filePath, 'Test', 2048, 0, 0);

    new BookStore(booksDir, preDb);

    const row = preDb.prepare('SELECT id FROM books').get() as { id: string };
    expect(row.id).toBe(pinnedId);

    preDb.close();
  });

  it('migration v4: adds chapter_count and chapter_spine_map columns to existing table', () => {
    const preDb = new Database(':memory:');
    preDb.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, path TEXT NOT NULL,
        title TEXT NOT NULL, file_as TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '', publisher TEXT NOT NULL DEFAULT '',
        series TEXT NOT NULL DEFAULT '', series_index REAL NOT NULL DEFAULT 0,
        identifiers TEXT NOT NULL DEFAULT '[]', subjects TEXT NOT NULL DEFAULT '[]',
        cover_data BLOB, cover_mime TEXT,
        size INTEGER NOT NULL, mtime INTEGER NOT NULL, added_at INTEGER NOT NULL
      )
    `);
    preDb.exec('PRAGMA user_version = 3');

    new BookStore(booksDir, preDb);

    const cols = preDb.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('chapter_count');
    expect(names).toContain('chapter_spine_map');
    expect(preDb.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 8 });

    preDb.close();
  });

  it('migration v5: adds chapter_names column with NULL default', () => {
    const cols = db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('chapter_names');
  });

  it('migration v8: adds page_count column to existing v7 table', () => {
    const preDb = new Database(':memory:');
    preDb.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, file_as TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
        publisher TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0, identifiers TEXT NOT NULL DEFAULT '[]',
        subjects TEXT NOT NULL DEFAULT '[]', cover_data BLOB, cover_mime TEXT,
        size INTEGER NOT NULL, mtime INTEGER NOT NULL, added_at INTEGER NOT NULL,
        chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]',
        chapter_names TEXT
      )
    `);
    preDb.exec('PRAGMA user_version = 7');

    new BookStore(booksDir, preDb);

    const cols = preDb.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain('page_count');
    expect(preDb.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 8 });

    preDb.close();
  });

  it('migration v8: backfills page_count for existing books on disk', () => {
    const preDb = new Database(':memory:');
    preDb.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, file_as TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
        publisher TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0, identifiers TEXT NOT NULL DEFAULT '[]',
        subjects TEXT NOT NULL DEFAULT '[]', cover_data BLOB, cover_mime TEXT,
        size INTEGER NOT NULL, mtime INTEGER NOT NULL, added_at INTEGER NOT NULL,
        chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]',
        chapter_names TEXT
      )
    `);
    preDb.exec('PRAGMA user_version = 7');

    const id = 'backfill-test';
    const epubPath = path.join(booksDir, `${id}.epub`);
    fs.writeFileSync(epubPath, makeMinimalEpubWithContent('A'.repeat(2048)));

    preDb
      .prepare('INSERT INTO books (id, title, size, mtime, added_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'Test Book', 100, 0, 0);

    new BookStore(booksDir, preDb);

    const row = preDb.prepare('SELECT page_count FROM books WHERE id = ?').get(id) as {
      page_count: number;
    };
    expect(row.page_count).toBe(2);

    preDb.close();
  });

  it('migration v8: skips missing EPUB files and leaves page_count at 0', () => {
    const preDb = new Database(':memory:');
    preDb.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, file_as TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
        publisher TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0, identifiers TEXT NOT NULL DEFAULT '[]',
        subjects TEXT NOT NULL DEFAULT '[]', cover_data BLOB, cover_mime TEXT,
        size INTEGER NOT NULL, mtime INTEGER NOT NULL, added_at INTEGER NOT NULL,
        chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]',
        chapter_names TEXT
      )
    `);
    preDb.exec('PRAGMA user_version = 7');
    preDb
      .prepare('INSERT INTO books (id, title, size, mtime, added_at) VALUES (?, ?, ?, ?, ?)')
      .run('missing-id', 'Gone', 100, 0, 0);

    expect(() => new BookStore(booksDir, preDb)).not.toThrow();

    const row = preDb.prepare('SELECT page_count FROM books WHERE id = ?').get('missing-id') as {
      page_count: number;
    };
    expect(row.page_count).toBe(0);

    preDb.close();
  });

  it('migration v8: does not re-run when user_version is already 8', () => {
    const preDb = new Database(':memory:');
    preDb.exec(`
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
    preDb.exec('PRAGMA user_version = 8');
    preDb
      .prepare('INSERT INTO books (id, title, page_count) VALUES (?, ?, ?)')
      .run('pinned-id', 'Test', 99);

    new BookStore(booksDir, preDb);

    const row = preDb.prepare('SELECT page_count FROM books WHERE id = ?').get('pinned-id') as {
      page_count: number;
    };
    expect(row.page_count).toBe(99);

    preDb.close();
  });
});

describe('reimportBook', () => {
  it('returns null for unknown book id', () => {
    expect(bookStore.reimportBook('doesnotexist')).toBeNull();
  });

  it('re-reads metadata from disk and updates the DB row', () => {
    const epubBuf = makeMinimalEpub('Original');
    const stagedPath = path.join(booksDir, 'staged-original.epub');
    fs.writeFileSync(stagedPath, epubBuf);
    const id = partialMD5(stagedPath);
    bookStore.addBook(id, stagedPath, {
      ...FAKE_META,
      title: 'Original',
    });

    // The file is now at <booksDir>/<id>.epub — overwrite it with new title
    const canonicalPath = path.join(booksDir, id + '.epub');
    const updatedBuf = makeMinimalEpub('Updated');
    fs.writeFileSync(canonicalPath, updatedBuf);

    const updated = bookStore.reimportBook(id);
    // ID may have changed due to ZIP rewrite — updated reflects new state
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('Updated');
  });

  it('cascades id change to progress table when partial MD5 shifts', () => {
    const epubBuf = makeMinimalEpub('Before');
    const stagedPath = path.join(booksDir, 'staged-cascade.epub');
    fs.writeFileSync(stagedPath, epubBuf);
    const oldId = partialMD5(stagedPath);
    bookStore.addBook(oldId, stagedPath, FAKE_META);
    const epubPath = path.join(booksDir, oldId + '.epub');

    // Insert a progress record for the old ID directly
    const db2 = (bookStore as unknown as { db: import('better-sqlite3').Database }).db;
    db2.exec(`CREATE TABLE IF NOT EXISTS progress (
      username TEXT NOT NULL, document TEXT NOT NULL, progress TEXT NOT NULL,
      percentage REAL NOT NULL, device TEXT NOT NULL, device_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL, PRIMARY KEY (username, document)
    )`);
    db2
      .prepare('INSERT INTO progress VALUES (?,?,?,?,?,?,?)')
      .run('alice', oldId, '/p[1]', 0.5, 'Kobo', 'd1', 1000);

    // Overwrite the file to force a different partial MD5
    const newBuf = makeMinimalEpub('After');
    fs.writeFileSync(epubPath, newBuf);

    const updated = bookStore.reimportBook(oldId);
    expect(updated).not.toBeNull();
    const newId = updated!.id;

    if (newId !== oldId) {
      // ID changed: old progress row should be gone, new one should exist
      const oldRow = db2.prepare('SELECT * FROM progress WHERE document=?').get(oldId);
      expect(oldRow).toBeUndefined();
      const newRow = db2.prepare('SELECT * FROM progress WHERE document=?').get(newId);
      expect(newRow).toBeDefined();
    }
    // If ID didn't change (unlikely but possible): still verify DB is consistent
    expect(bookStore.getBookById(newId)).not.toBeNull();
  });

  it('inherits orphaned progress under newId when no book owns that hash', () => {
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
    bookStore.addBook(oldId, epubPath, FAKE_META);

    const db2 = (bookStore as unknown as { db: import('better-sqlite3').Database }).db;
    db2.exec(`CREATE TABLE IF NOT EXISTS progress (
      username TEXT NOT NULL, document TEXT NOT NULL, progress TEXT NOT NULL,
      percentage REAL NOT NULL, device TEXT NOT NULL, device_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL, PRIMARY KEY (username, document)
    )`);
    // Orphaned progress under newId (no book owns newId)
    db2
      .prepare('INSERT INTO progress VALUES (?,?,?,?,?,?,?)')
      .run('alice', newId, '/p[2]', 0.8, 'Kobo', 'd1', 2000);

    const mockImporter = { parseEpub: () => FAKE_META, partialMD5: () => newId };
    const result = bookStore.reimportBook(oldId, mockImporter);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(newId);
    // Orphaned progress is now owned by the book
    const row = db2.prepare('SELECT * FROM progress WHERE document=?').get(newId) as
      | { username: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.username).toBe('alice');
    // Old id has no progress
    expect(db2.prepare('SELECT * FROM progress WHERE document=?').get(oldId)).toBeUndefined();
  });

  it('keeps newer progress and discards older when both ids have records for the same user', () => {
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
    bookStore.addBook(oldId, epubPath, FAKE_META);

    const db2 = (bookStore as unknown as { db: import('better-sqlite3').Database }).db;
    db2.exec(`CREATE TABLE IF NOT EXISTS progress (
      username TEXT NOT NULL, document TEXT NOT NULL, progress TEXT NOT NULL,
      percentage REAL NOT NULL, device TEXT NOT NULL, device_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL, PRIMARY KEY (username, document)
    )`);
    // alice: current progress is newer (ts=3000) than orphaned (ts=1000) → current wins
    db2
      .prepare('INSERT INTO progress VALUES (?,?,?,?,?,?,?)')
      .run('alice', oldId, '/p[5]', 0.9, 'Kobo', 'd1', 3000);
    db2
      .prepare('INSERT INTO progress VALUES (?,?,?,?,?,?,?)')
      .run('alice', newId, '/p[2]', 0.4, 'Kobo', 'd1', 1000);
    // bob: orphaned progress is newer (ts=5000) than current (ts=2000) → orphaned wins
    db2
      .prepare('INSERT INTO progress VALUES (?,?,?,?,?,?,?)')
      .run('bob', oldId, '/p[1]', 0.2, 'Kobo', 'd2', 2000);
    db2
      .prepare('INSERT INTO progress VALUES (?,?,?,?,?,?,?)')
      .run('bob', newId, '/p[9]', 0.95, 'Kobo', 'd2', 5000);

    const mockImporter = { parseEpub: () => FAKE_META, partialMD5: () => newId };
    bookStore.reimportBook(oldId, mockImporter);

    type Row = { username: string; progress: string; timestamp: number };
    const aliceRow = db2
      .prepare('SELECT * FROM progress WHERE username=? AND document=?')
      .get('alice', newId) as Row;
    expect(aliceRow).toBeDefined();
    expect(aliceRow.progress).toBe('/p[5]'); // alice's newer current record won
    expect(aliceRow.timestamp).toBe(3000);

    const bobRow = db2
      .prepare('SELECT * FROM progress WHERE username=? AND document=?')
      .get('bob', newId) as Row;
    expect(bobRow).toBeDefined();
    expect(bobRow.progress).toBe('/p[9]'); // bob's newer orphaned record won
    expect(bobRow.timestamp).toBe(5000);

    // No records left under oldId
    expect(
      db2.prepare('SELECT COUNT(*) AS n FROM progress WHERE document=?').get(oldId)
    ).toMatchObject({ n: 0 });
  });
});

describe('book_thumbnails', () => {
  it('saveThumbnail stores and getThumbnail retrieves', () => {
    bookStore.addBook('bk1', stage('bk1'), FAKE_META);
    const data = Buffer.from('thumb-data');
    bookStore.saveThumbnail('bk1', 150, data, 'image/jpeg');
    const result = bookStore.getThumbnail('bk1', 150);
    expect(result).not.toBeNull();
    expect(result!.data.toString()).toBe('thumb-data');
    expect(result!.mime).toBe('image/jpeg');
  });

  it('getThumbnail returns null when not present', () => {
    bookStore.addBook('bk2', stage('bk2'), FAKE_META);
    expect(bookStore.getThumbnail('bk2', 150)).toBeNull();
  });

  it('saveThumbnail upserts on (book_id, width) conflict', () => {
    bookStore.addBook('bk3', stage('bk3'), FAKE_META);
    bookStore.saveThumbnail('bk3', 150, Buffer.from('v1'), 'image/jpeg');
    bookStore.saveThumbnail('bk3', 150, Buffer.from('v2'), 'image/jpeg');
    expect(bookStore.getThumbnail('bk3', 150)!.data.toString()).toBe('v2');
  });

  it('pruneThumbnails removes rows whose width is not in the config list', () => {
    bookStore.addBook('bk4', stage('bk4'), FAKE_META);
    bookStore.saveThumbnail('bk4', 60, Buffer.from('x'), 'image/jpeg');
    bookStore.saveThumbnail('bk4', 150, Buffer.from('y'), 'image/jpeg');
    bookStore.saveThumbnail('bk4', 300, Buffer.from('z'), 'image/jpeg');
    const removed = bookStore.pruneThumbnails([60, 150]);
    expect(removed).toBe(1);
    expect(bookStore.getThumbnail('bk4', 60)).not.toBeNull();
    expect(bookStore.getThumbnail('bk4', 150)).not.toBeNull();
    expect(bookStore.getThumbnail('bk4', 300)).toBeNull();
  });

  it('pruneThumbnails with empty array removes all thumbnails', () => {
    bookStore.addBook('bk5', stage('bk5'), FAKE_META);
    bookStore.saveThumbnail('bk5', 60, Buffer.from('x'), 'image/jpeg');
    const removed = bookStore.pruneThumbnails([]);
    expect(removed).toBe(1);
  });

  it('getMissingThumbnailPairs returns pairs without thumbnails', () => {
    const metaWithCover = {
      ...FAKE_META,
      coverData: Buffer.from('cover'),
      coverMime: 'image/jpeg',
    };
    bookStore.addBook('bk6', stage('bk6'), metaWithCover);
    bookStore.addBook('bk7', stage('bk7'), metaWithCover);
    bookStore.saveThumbnail('bk6', 60, Buffer.from('x'), 'image/jpeg'); // already has 60px

    const missing = bookStore.getMissingThumbnailPairs([60, 170]);
    // bk6 needs 170, bk7 needs both
    expect(missing).toContainEqual({ bookId: 'bk6', width: 170 });
    expect(missing).toContainEqual({ bookId: 'bk7', width: 60 });
    expect(missing).toContainEqual({ bookId: 'bk7', width: 170 });
    expect(missing).not.toContainEqual({ bookId: 'bk6', width: 60 });
  });

  it('getMissingThumbnailPairs ignores books without covers', () => {
    bookStore.addBook('bk8', stage('bk8'), {
      ...FAKE_META,
      coverData: null,
      coverMime: null,
    });
    const missing = bookStore.getMissingThumbnailPairs([60]);
    expect(missing.map((p) => p.bookId)).not.toContain('bk8');
  });

  it('deleting a book cascades to book_thumbnails', () => {
    bookStore.addBook('bk9', stage('bk9'), FAKE_META);
    bookStore.saveThumbnail('bk9', 60, Buffer.from('x'), 'image/jpeg');
    bookStore.deleteBook('bk9');
    expect(bookStore.getThumbnail('bk9', 60)).toBeNull();
  });

  it('reimportBook updates book_thumbnails book_id when id changes', () => {
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
    bookStore.addBook(originalId, epubPath, FAKE_META);
    bookStore.saveThumbnail(originalId, 60, Buffer.from('thumb'), 'image/jpeg');

    const mockImporter = {
      parseEpub: () => FAKE_META,
      partialMD5: () => newId,
    };
    bookStore.reimportBook(originalId, mockImporter);

    // Thumbnail should now be under new ID (not lost, not causing FK error)
    expect(bookStore.getThumbnail(newId, 60)).not.toBeNull();
    expect(bookStore.getThumbnail(originalId, 60)).toBeNull();
  });

  it('renames file on disk from <oldId>.epub to <newId>.epub when hash changes', () => {
    const oldId = 'old-id-aaaa';
    const oldPath = path.join(booksDir, oldId + '.epub');
    fs.writeFileSync(oldPath, 'epub-bytes');
    bookStore.addBook(oldId, oldPath, FAKE_META);

    const newId = 'new-id-bbbb';
    const mockImporter: ScanImporter = {
      parseEpub: () => ({ ...FAKE_META, title: 'New Title' }),
      partialMD5: () => newId,
    };
    bookStore.reimportBook(oldId, mockImporter);

    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(path.join(booksDir, newId + '.epub'))).toBe(true);
  });

  it('does not rename when hash is unchanged', () => {
    const id = 'stable-id';
    const filePath = path.join(booksDir, id + '.epub');
    fs.writeFileSync(filePath, 'epub-bytes');
    bookStore.addBook(id, filePath, FAKE_META);

    const mockImporter: ScanImporter = {
      parseEpub: () => ({ ...FAKE_META, title: 'Edited' }),
      partialMD5: () => id,
    };
    bookStore.reimportBook(id, mockImporter);

    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('throws BookHashCollisionError when new hash collides with another book', () => {
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
    bookStore.addBook(bookAId, epubPath, FAKE_META);
    bookStore.addBook(bookBId, stage('book-b-id'), FAKE_META);

    // Mock importer returns bookBId as the new hash — collision with existing book
    const mockImporter = {
      parseEpub: () => FAKE_META,
      partialMD5: () => bookBId,
    };

    expect(() => bookStore.reimportBook(bookAId, mockImporter)).toThrow(BookHashCollisionError);
    // Both books must remain intact after the failed reimport
    expect(bookStore.getBookById(bookAId)).not.toBeNull();
    expect(bookStore.getBookById(bookBId)).not.toBeNull();
  });
});

describe('migration v7 (drop filename/path columns and canonicalize on-disk names)', () => {
  it('renames files to <id>.epub and rebuilds the books table', () => {
    const dbPath = path.join(booksDir, 'mig.sqlite');
    const seedDb = new Database(dbPath);
    seedDb.exec(`
      CREATE TABLE books (
        id            TEXT    PRIMARY KEY,
        filename      TEXT    NOT NULL UNIQUE,
        path          TEXT    NOT NULL,
        title         TEXT    NOT NULL,
        file_as       TEXT    NOT NULL DEFAULT '',
        author        TEXT    NOT NULL DEFAULT '',
        description   TEXT    NOT NULL DEFAULT '',
        publisher     TEXT    NOT NULL DEFAULT '',
        series        TEXT    NOT NULL DEFAULT '',
        series_index  REAL    NOT NULL DEFAULT 0,
        identifiers   TEXT    NOT NULL DEFAULT '[]',
        subjects      TEXT    NOT NULL DEFAULT '[]',
        cover_data    BLOB,
        cover_mime    TEXT,
        size          INTEGER NOT NULL,
        mtime         INTEGER NOT NULL,
        added_at      INTEGER NOT NULL,
        chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]',
        chapter_names TEXT
      );
      CREATE TABLE book_thumbnails (
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE ON UPDATE CASCADE,
        width   INTEGER NOT NULL,
        data    BLOB NOT NULL,
        mime    TEXT NOT NULL,
        PRIMARY KEY (book_id, width)
      );
      PRAGMA user_version = 6;
    `);

    const oldOnDisk = path.join(booksDir, 'arbitrary.epub');
    fs.writeFileSync(oldOnDisk, 'content');

    seedDb
      .prepare(
        `INSERT INTO books (id, filename, path, title, size, mtime, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('book-id-1', 'arbitrary.epub', oldOnDisk, 'A Book', 7, 0, 0);
    seedDb.close();

    const realDb = new Database(dbPath);
    const store = new BookStore(booksDir, realDb);

    expect(fs.existsSync(oldOnDisk)).toBe(false);
    expect(fs.existsSync(path.join(booksDir, 'book-id-1.epub'))).toBe(true);

    const book = store.getBookById('book-id-1');
    expect(book!.title).toBe('A Book');

    const cols = realDb.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain('filename');
    expect(colNames).not.toContain('path');

    const { user_version: uv } = realDb.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    expect(uv).toBeGreaterThanOrEqual(7);

    realDb.close();
  });

  it('logs and skips rows whose on-disk file is missing', () => {
    const dbPath = path.join(booksDir, 'missing.sqlite');
    const seedDb = new Database(dbPath);
    seedDb.exec(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        file_as TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        publisher TEXT NOT NULL DEFAULT '',
        series TEXT NOT NULL DEFAULT '',
        series_index REAL NOT NULL DEFAULT 0,
        identifiers TEXT NOT NULL DEFAULT '[]',
        subjects TEXT NOT NULL DEFAULT '[]',
        cover_data BLOB,
        cover_mime TEXT,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        chapter_count INTEGER NOT NULL DEFAULT 0,
        chapter_spine_map TEXT NOT NULL DEFAULT '[]',
        chapter_names TEXT
      );
      CREATE TABLE book_thumbnails (
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE ON UPDATE CASCADE,
        width INTEGER NOT NULL,
        data BLOB NOT NULL,
        mime TEXT NOT NULL,
        PRIMARY KEY (book_id, width)
      );
      PRAGMA user_version = 6;
    `);

    const nonexistent = path.join(booksDir, 'gone.epub');
    seedDb
      .prepare(
        `INSERT INTO books (id, filename, path, title, size, mtime, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('ghost-id', 'gone.epub', nonexistent, 'Ghost', 7, 0, 0);
    seedDb.close();

    const realDb = new Database(dbPath);
    const store = new BookStore(booksDir, realDb);

    const book = store.getBookById('ghost-id');
    expect(book).not.toBeNull();

    realDb.close();
  });
});

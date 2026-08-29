import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import AdmZip from 'adm-zip';

import { runMigrations } from '../db/migrate';
import { EpubMeta, Owner, PageCursor } from '../types';
import { BookStore } from './book-store';
import { partialMD5 } from './epub-parser';

vi.mock('../logger');

const OWNER: Owner = { userId: 'usr_test000000000000000', username: 'alice' };

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
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
  fs.rmSync(booksRoot, { recursive: true });
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

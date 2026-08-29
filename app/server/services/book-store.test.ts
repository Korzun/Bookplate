import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import AdmZip from 'adm-zip';

import { runMigrations } from '../db/migrate';
import { EpubMeta, Owner } from '../types';
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

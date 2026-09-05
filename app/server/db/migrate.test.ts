import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaClient } from '@prisma/client';
import AdmZip from 'adm-zip';

import { partialMD5 } from '../services/epub-parser';
import { createPrismaClient } from './client';
import { runMigrations } from './migrate';

vi.mock('../logger');

describe('data_v11_per_user_libraries', () => {
  let tmpDir: string;
  let booksDir: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
    booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Builds the pre-per-user schema and marks all earlier migrations applied. */
  async function seedLegacyDb(opts: {
    users: Array<{ id: string; username: string }>;
    bookIds: string[];
  }): Promise<void> {
    // Minimal legacy schema (post-0004, pre-0005 shape)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "books" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "file_as" TEXT NOT NULL DEFAULT '',
        "author" TEXT NOT NULL DEFAULT '',
        "description" TEXT NOT NULL DEFAULT '',
        "publisher" TEXT NOT NULL DEFAULT '',
        "series" TEXT NOT NULL DEFAULT '',
        "series_index" REAL NOT NULL DEFAULT 0,
        "identifiers" TEXT NOT NULL DEFAULT '[]',
        "subjects" TEXT NOT NULL DEFAULT '[]',
        "cover_data" BLOB,
        "cover_mime" TEXT,
        "size" INTEGER NOT NULL,
        "mtime" REAL NOT NULL,
        "added_at" REAL NOT NULL,
        "chapter_count" INTEGER NOT NULL DEFAULT 0,
        "chapter_spine_map" TEXT NOT NULL DEFAULT '[]',
        "chapter_names" TEXT,
        "page_count" INTEGER NOT NULL DEFAULT 0
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "book_thumbnails" (
        "book_id" TEXT NOT NULL,
        "width" INTEGER NOT NULL,
        "data" BLOB NOT NULL,
        "mime" TEXT NOT NULL,
        PRIMARY KEY ("book_id", "width")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "book_id_history" (
        "old_id" TEXT NOT NULL PRIMARY KEY,
        "current_id" TEXT NOT NULL,
        "timestamp" REAL NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        "type" TEXT NOT NULL DEFAULT 'edit'
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "users" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "username" TEXT NOT NULL,
        "password_hash" TEXT,
        "sync_password" TEXT,
        "must_change_password" BOOLEAN NOT NULL DEFAULT 0
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "users_username_key" ON "users"("username")`
    );
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "progress" (
        "user_id" TEXT NOT NULL,
        "document" TEXT NOT NULL,
        "progress" TEXT NOT NULL,
        "percentage" REAL NOT NULL,
        "device" TEXT NOT NULL,
        "device_id" TEXT NOT NULL,
        "timestamp" INTEGER NOT NULL,
        PRIMARY KEY ("user_id", "document")
      )
    `);
    // Mark every migration up to and including split_password_fields/must_change_password
    // as applied so runMigrations only runs 0005 + the data migrations.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "_prisma_migrations" (
        id TEXT NOT NULL PRIMARY KEY, checksum TEXT NOT NULL, finished_at DATETIME,
        migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME,
        started_at DATETIME NOT NULL DEFAULT current_timestamp,
        applied_steps_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    const applied = [
      '0000_baseline',
      '0001_add_book_id_history',
      '0002_add_book_id_history_timestamp',
      '0003_add_book_id_history_type',
      '0004_add_user_id',
      '20260609100450_split_password_fields',
      '20260610120000_add_must_change_password',
      'data_v10_user_surrogate_id',
      'data_v2_book_ids',
      'data_v8_page_count',
      'data_v9_chapter_data',
    ];
    for (const name of applied) {
      await prisma.$executeRaw`
        INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
        VALUES (${crypto.randomUUID()}, '', ${name}, current_timestamp, 1)
      `;
    }

    for (const u of opts.users) {
      await prisma.$executeRaw`INSERT INTO users (id, username) VALUES (${u.id}, ${u.username})`;
    }
    for (const id of opts.bookIds) {
      await prisma.$executeRaw`
        INSERT INTO books (id, title, size, mtime, added_at) VALUES (${id}, ${'Book ' + id}, 1, 0, 0)
      `;
      fs.writeFileSync(path.join(booksDir, id + '.epub'), 'epub-' + id);
    }
  }

  it('copies every book to every user and removes the flat files', async () => {
    await seedLegacyDb({
      users: [
        { id: 'u1', username: 'alice' },
        { id: 'u2', username: 'bob' },
      ],
      bookIds: ['a'.repeat(32), 'b'.repeat(32)],
    });

    await runMigrations(prisma, booksDir);

    for (const username of ['alice', 'bob']) {
      for (const id of ['a'.repeat(32), 'b'.repeat(32)]) {
        expect(fs.existsSync(path.join(booksDir, username, id + '.epub'))).toBe(true);
      }
    }
    expect(fs.existsSync(path.join(booksDir, 'a'.repeat(32) + '.epub'))).toBe(false);
    expect(fs.existsSync(path.join(booksDir, 'b'.repeat(32) + '.epub'))).toBe(false);

    const rows = await prisma.$queryRaw<Array<{ user_id: string; id: string }>>`
      SELECT user_id, id FROM books ORDER BY user_id, id
    `;
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set(['u1', 'u2']));
  });

  it('renames filesystem-unsafe usernames with a deduplicating suffix', async () => {
    await seedLegacyDb({
      users: [
        { id: 'u1', username: 'bad name' },
        { id: 'u2', username: 'bad-name' },
      ],
      bookIds: [],
    });

    await runMigrations(prisma, booksDir);

    const users = await prisma.$queryRaw<Array<{ id: string; username: string }>>`
      SELECT id, username FROM users ORDER BY id
    `;
    expect(users.find((u) => u.id === 'u2')!.username).toBe('bad-name'); // already valid
    expect(users.find((u) => u.id === 'u1')!.username).toBe('bad-name-2'); // sanitized + deduped
  });

  it('deletes legacy files when zero users exist', async () => {
    await seedLegacyDb({ users: [], bookIds: ['c'.repeat(32)] });

    await runMigrations(prisma, booksDir);

    expect(fs.existsSync(path.join(booksDir, 'c'.repeat(32) + '.epub'))).toBe(false);
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM books`;
    expect(rows).toHaveLength(0);
  });

  it('does not run twice', async () => {
    await seedLegacyDb({ users: [{ id: 'u1', username: 'alice' }], bookIds: ['d'.repeat(32)] });
    await runMigrations(prisma, booksDir);
    await runMigrations(prisma, booksDir); // second run must be a no-op
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM books`;
    expect(rows).toHaveLength(1);
  });
});

describe('data_v13_series_meta backfill', () => {
  let tmpDir: string;
  let booksDir: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-v13-'));
    booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('backfills aggregate fields for existing series', async () => {
    // Run migrations to establish the full modern schema
    await runMigrations(prisma, booksDir);

    // Directly insert a user, series, and two books bypassing addBook
    // (simulates data that existed before this migration ran)
    await prisma.$executeRaw`INSERT INTO users (id, username) VALUES ('u1', 'alice')`;
    await prisma.$executeRaw`
      INSERT INTO series (id, user_id, name, sort_key)
      VALUES ('s1', 'u1', 'Dune', 'Dune')
    `;
    await prisma.$executeRaw`
      INSERT INTO books (user_id, id, title, series, series_index, series_id,
        subjects, author, publisher, page_count, size, mtime, added_at)
      VALUES
        ('u1', 'b1', 'Dune', 'Dune', 1, 's1',
         '["Science Fiction","Space Opera"]', 'Frank Herbert', 'Chilton', 412, 1, 0, 0),
        ('u1', 'b2', 'Dune Messiah', 'Dune', 2, 's1',
         '["science fiction","Politics"]', 'frank herbert', 'Chilton', 256, 1, 0, 0)
    `;

    // Delete the data_v13_series_meta record so it runs again
    await prisma.$executeRaw`
      DELETE FROM _prisma_migrations WHERE migration_name = 'data_v13_series_meta'
    `;

    await runMigrations(prisma, booksDir);

    const series = await prisma.$queryRaw<
      Array<{
        book_count: number;
        author: string;
        publisher: string;
        total_pages: number;
        subjects: string;
      }>
    >`SELECT book_count, author, publisher, total_pages, subjects FROM series WHERE id = 's1'`;

    expect(series[0].book_count).toBe(2);
    expect(series[0].author).toBe('Frank Herbert'); // first-seen casing
    expect(series[0].publisher).toBe('Chilton');
    expect(series[0].total_pages).toBe(668);
    const subjects = JSON.parse(series[0].subjects) as string[];
    // case-insensitive dedup: 'science fiction' merges with 'Science Fiction'
    expect(subjects).toContain('Science Fiction');
    expect(subjects).toContain('Politics');
    expect(subjects).toHaveLength(3); // Space Opera, Science Fiction, Politics
  });

  it('does not run twice', async () => {
    await runMigrations(prisma, booksDir);
    await runMigrations(prisma, booksDir);
    // No error = idempotent
  });
});

describe('devices and device_editions tables', () => {
  let tmpDir: string;
  let booksDir: string;
  let prisma: PrismaClient;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-devices-'));
    booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
    await runMigrations(prisma, booksDir);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the devices and device_editions tables', async () => {
    await prisma.device.create({
      data: { id: 'd1', name: 'Kindle', slug: 'kindle', coverFit: 'contain' },
    });
    const devices = await prisma.device.findMany();
    expect(devices).toHaveLength(1);
    expect(devices[0].bwCover).toBe(false);

    await prisma.deviceEdition.create({
      data: {
        userId: 'u1',
        originalBookId: 'b1',
        deviceId: 'd1',
        editionId: 'e1',
        settingsHash: 'h1',
      },
    });
    const editions = await prisma.deviceEdition.findMany();
    expect(editions).toHaveLength(1);
  });

  it('rejects an invalid cover_fit value', async () => {
    await expect(
      prisma.device.create({ data: { id: 'd2', name: 'Bad', slug: 'bad', coverFit: 'nonsense' } })
    ).rejects.toThrow();
  });
});

describe('data_v17_validation', () => {
  let tmpDir: string;
  let booksDir: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-val-'));
    booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the validations and validation_messages tables', async () => {
    await runMigrations(prisma, booksDir);
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('validations','validation_messages') ORDER BY name`
    );
    expect(rows.map((r) => r.name)).toEqual(['validation_messages', 'validations']);
  });
});

describe('data_v18_book_requests', () => {
  let tmpDir: string;
  let booksDir: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-req-'));
    booksDir = path.join(tmpDir, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the book_requests table', async () => {
    await runMigrations(prisma, booksDir);
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='book_requests'`
    );
    expect(rows.map((r) => r.name)).toEqual(['book_requests']);
  });

  it('enforces the compound unique that backs the cursor', async () => {
    await runMigrations(prisma, booksDir);
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='book_requests'`
    );
    expect(rows.map((r) => r.name)).toContain('book_requests_user_id_created_at_id_key');
  });
});

// Moved from `services/book-store.test.ts` (Task 9b, `BookStore`'s deletion):
// these assert `runMigrations` itself (id recompute, NanoID surrogate ids,
// the `chapter_names`/`page_count` columns), not anything `BookStore` ever
// did — they belong here with every other migration suite, not in a
// book-seeding test file.
describe('legacy id-recompute and page-count migrations', () => {
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

  const BOOKS_SCHEMA = `
    CREATE TABLE books (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, path TEXT NOT NULL,
      title TEXT NOT NULL, file_as TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', series TEXT NOT NULL DEFAULT '',
      series_index REAL NOT NULL DEFAULT 0, cover_data BLOB, cover_mime TEXT,
      size INTEGER NOT NULL, mtime INTEGER NOT NULL, added_at INTEGER NOT NULL
    )
  `;

  let prisma: PrismaClient;
  let booksRoot: string;
  let booksDir: string;
  let dbPath: string;

  beforeEach(async () => {
    booksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'books-test-'));
    booksDir = path.join(booksRoot, 'alice');
    fs.mkdirSync(booksDir, { recursive: true });
    dbPath = path.join(
      os.tmpdir(),
      `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );
    prisma = createPrismaClient(`file:${dbPath}`);
    await runMigrations(prisma, booksRoot);
    await prisma.user.create({ data: { id: 'usr_test000000000000000', username: 'alice' } });
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

  it('migration v2: recomputes stale book ID to match corrected partial MD5', async () => {
    const filePath = path.join(booksDir, 'migrate-v2.epub');
    fs.writeFileSync(filePath, Buffer.alloc(2048, 'x'));
    const correctId = partialMD5(filePath);

    const migDbPath = path.join(
      os.tmpdir(),
      `migtest-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );
    const migPrisma = createPrismaClient(`file:${migDbPath}`);
    await migPrisma.$executeRawUnsafe(BOOKS_SCHEMA);
    await migPrisma.$executeRawUnsafe(`
      CREATE TABLE users (username TEXT NOT NULL PRIMARY KEY, key TEXT NOT NULL)
    `);
    await migPrisma.$executeRaw`INSERT INTO users (username, key) VALUES ('alice', 'k')`;
    await migPrisma.$executeRaw`INSERT INTO books (id, filename, path, title, size, mtime, added_at) VALUES ('stale-id-from-old-algo', 'migrate-v2.epub', ${filePath}, 'Test', 2048, 0, 0)`;

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
    const migPrisma = createPrismaClient(`file:${migDbPath}`);
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
    const migPrisma = createPrismaClient(`file:${migDbPath}`);
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
    const migPrisma = createPrismaClient(`file:${migDbPath}`);
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
    const migPrisma = createPrismaClient(`file:${migDbPath}`);
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
    const migPrisma = createPrismaClient(`file:${migDbPath}`);
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
    const migPrisma = createPrismaClient(`file:${migDbPath}`);
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

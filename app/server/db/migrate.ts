import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { parseEpub, partialMD5 } from '../services/epub-parser';
import { generateUserId } from '../utils/id';
import { isValidUsername, sanitizeUsername } from '../utils/username';
import { logger } from '../logger';

const log = logger('Migrate');

/**
 * Resolves the Prisma Migrate migrations directory, which lives at
 * `prisma/migrations/` relative to the server package root. Works for both
 * the compiled production layout (dist/db/migrate.js → ../../prisma/migrations)
 * and the ts-node development layout (db/migrate.ts → ../prisma/migrations).
 */
function findMigrationsDir(): string | null {
  const candidates = [
    path.join(__dirname, '../../prisma/migrations'), // compiled: dist/db → server root
    path.join(__dirname, '../prisma/migrations'), // ts-node: db → server root
  ];
  return candidates.find((d) => fs.existsSync(d)) ?? null;
}

/**
 * Applies any Prisma Migrate SQL files that have not yet been recorded in
 * `_prisma_migrations`.  For the `0_baseline` migration specifically, the SQL
 * is skipped when the `books` table already exists (legacy database) — the
 * record is written so Prisma tooling sees the correct state without re-running
 * DDL against a schema that is already in place.
 *
 * Future migrations generated with `prisma migrate dev` are always executed.
 */
async function applyPendingMigrations(prisma: PrismaClient): Promise<void> {
  const migrationsDir = findMigrationsDir();
  if (!migrationsDir) return;

  // Ensure the Prisma Migrate tracking table exists.
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS _prisma_migrations (
      id                  TEXT     NOT NULL PRIMARY KEY,
      checksum            TEXT     NOT NULL,
      finished_at         DATETIME,
      migration_name      TEXT     NOT NULL,
      logs                TEXT,
      rolled_back_at      DATETIME,
      started_at          DATETIME NOT NULL DEFAULT current_timestamp,
      applied_steps_count INTEGER  NOT NULL DEFAULT 0
    )
  `;

  const applied = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL
  `;
  const appliedSet = new Set(applied.map((r) => r.migration_name));

  const migrationNames = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const migName of migrationNames) {
    if (appliedSet.has(migName)) continue;

    const sqlPath = path.join(migrationsDir, migName, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;

    const sql = fs.readFileSync(sqlPath, 'utf-8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const migId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    // For the baseline migration, skip executing the SQL when the schema is
    // already present (databases upgraded from the pre-Prisma migration system).
    // All subsequent migrations generated with `prisma migrate dev` are always executed.
    // Note: the directory was renamed from 0_baseline → 0000_baseline; both names
    // are treated as the baseline guard so that production databases with the old
    // migration name recorded continue to work correctly.
    let skipSql = false;
    if (migName === '0_baseline' || migName === '0000_baseline') {
      // Also mark the legacy name as applied so it is not re-run after the rename.
      const legacyName = '0_baseline';
      if (migName === '0000_baseline' && !appliedSet.has(legacyName)) {
        const legacyApplied = await prisma.$queryRaw<Array<{ migration_name: string }>>`
          SELECT migration_name FROM _prisma_migrations
          WHERE migration_name = ${legacyName} AND rolled_back_at IS NULL
        `;
        if (legacyApplied.length > 0) {
          skipSql = true;
        }
      }
      if (!skipSql) {
        const existing = await prisma.$queryRaw<Array<{ name: string }>>`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'books'
        `;
        skipSql = existing.length > 0;
      }
    }

    await prisma.$executeRaw`
      INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count)
      VALUES (${migId}, ${checksum}, ${migName}, ${startedAt}, 0)
    `;

    if (!skipSql) {
      const statements = sql
        .replace(/--[^\n]*/g, '') // strip line comments
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of statements) {
        await prisma.$executeRawUnsafe(stmt);
      }
    }

    await prisma.$executeRaw`
      UPDATE _prisma_migrations
      SET finished_at = ${new Date().toISOString()}, applied_steps_count = 1
      WHERE id = ${migId}
    `;

    log.info(
      skipSql
        ? `Prisma migration recorded (schema already present): ${migName}`
        : `Prisma migration applied: ${migName}`
    );
  }
}

/**
 * Runs a named data migration exactly once, tracking completion in
 * `_prisma_migrations` alongside the Prisma DDL migrations.
 */
async function runDataMigration(
  prisma: PrismaClient,
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  const existing = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations
    WHERE migration_name = ${name} AND rolled_back_at IS NULL
    LIMIT 1
  `;
  if (existing.length > 0) return;

  await fn();

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await prisma.$executeRaw`
    INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
    VALUES (${id}, '', ${name}, ${now}, ${now}, 1)
  `;
}

/**
 * Applies all pending Prisma DDL migrations and one-time data migrations.
 * Safe to call on every startup.
 */
export async function runMigrations(prisma: PrismaClient, booksDir: string): Promise<void> {
  // Enable FK enforcement for the lifetime of this connection so that ON DELETE
  // CASCADE / ON UPDATE CASCADE rules fire correctly at the database level.
  await prisma.$executeRaw`PRAGMA foreign_keys = ON`;

  // Apply any pending Prisma Migrate SQL files and keep _prisma_migrations in sync.
  await applyPendingMigrations(prisma);

  // Data migration: backfill NanoID-format surrogate IDs for any users left
  // over from before the "id" column existed, then recreate "users" with "id"
  // as its primary key and "progress" with a "user_id" foreign key.
  //
  // FK enforcement is disabled for both the backfill and the recreate: (1) the
  // backfill UPDATE needs FKs off because the new `refresh_tokens` table's FK
  // to `users(id)` fails SQLite's FK validation while legacy `users.id` lacks a
  // unique index; (2) the recreate needs FKs off to prevent dropping "users"
  // while "progress.username" still carries an ON DELETE CASCADE foreign key
  // referencing it, which would trigger SQLite's implicit cascade and silently
  // delete every progress row before "progress" itself is rebuilt.
  await runDataMigration(prisma, 'data_v10_user_surrogate_id', async () => {
    await prisma.$executeRaw`PRAGMA foreign_keys = OFF`;

    const pending = await prisma.$queryRaw<Array<{ username: string }>>`
      SELECT username FROM users WHERE id IS NULL
    `;
    for (const { username } of pending) {
      await prisma.$executeRaw`UPDATE users SET id = ${generateUserId()} WHERE username = ${username}`;
    }

    await prisma.$executeRawUnsafe(`
      CREATE TABLE "users_new" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "username" TEXT NOT NULL,
        "password_hash" TEXT,
        "sync_password" TEXT,
        "must_change_password" BOOLEAN NOT NULL DEFAULT 0
      )
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "users_new" ("id", "username", "password_hash", "sync_password", "must_change_password")
        SELECT "id", "username", "password_hash", "sync_password", 0 FROM "users"
    `);
    await prisma.$executeRawUnsafe(`DROP TABLE "users"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "users_new" RENAME TO "users"`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "users_username_key" ON "users"("username")`
    );

    // Defensive guard for legacy test databases that don't create "progress".
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "progress" (
        "username" TEXT NOT NULL,
        "document" TEXT NOT NULL,
        "progress" TEXT NOT NULL,
        "percentage" REAL NOT NULL,
        "device" TEXT NOT NULL,
        "device_id" TEXT NOT NULL,
        "timestamp" INTEGER NOT NULL,
        PRIMARY KEY ("username", "document")
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE "progress_new" (
        "user_id" TEXT NOT NULL,
        "document" TEXT NOT NULL,
        "progress" TEXT NOT NULL,
        "percentage" REAL NOT NULL,
        "device" TEXT NOT NULL,
        "device_id" TEXT NOT NULL,
        "timestamp" INTEGER NOT NULL,
        PRIMARY KEY ("user_id", "document"),
        CONSTRAINT "progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "progress_new" ("user_id", "document", "progress", "percentage", "device", "device_id", "timestamp")
        SELECT u."id", p."document", p."progress", p."percentage", p."device", p."device_id", p."timestamp"
        FROM "progress" p
        INNER JOIN "users" u ON u."username" = p."username"
    `);
    await prisma.$executeRawUnsafe(`DROP TABLE "progress"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "progress_new" RENAME TO "progress"`);

    await prisma.$executeRaw`PRAGMA foreign_keys = ON`;
  });

  // Data migration: recompute book IDs with corrected partial MD5.
  // The original algorithm read 1 KiB starting at offset 256; the corrected one
  // reads from offset 0. Only relevant for databases with the old `path` column.
  await runDataMigration(prisma, 'data_v2_book_ids', async () => {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    if (!cols.some((c) => c.name === 'path')) return; // modern schema, skip

    const books = await prisma.$queryRaw<Array<{ id: string; path: string }>>`
      SELECT id, path FROM books
    `;
    const progressExists =
      (
        await prisma.$queryRaw<Array<{ name: string }>>`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'progress'
        `
      ).length > 0;

    let recomputed = 0;
    await prisma.$transaction(async (tx) => {
      for (const book of books) {
        let newId: string;
        try {
          newId = partialMD5(book.path);
        } catch {
          continue;
        }
        if (newId !== book.id) {
          await tx.$executeRaw`UPDATE books SET id = ${newId} WHERE id = ${book.id}`;
          if (progressExists) {
            await tx.$executeRaw`UPDATE progress SET document = ${newId} WHERE document = ${book.id}`;
          }
          recomputed++;
        }
      }
    });
    if (recomputed > 0) log.info(`Data migration (book IDs): recomputed ${recomputed} book ID(s)`);
  });

  // Data migration: backfill page_count from EPUB parsing for books imported
  // before page counting was introduced.
  await runDataMigration(prisma, 'data_v8_page_count', async () => {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    if (!cols.some((c) => c.name === 'page_count')) return; // pre-v8 schema, skip

    const toBackfill = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM books WHERE page_count = 0
    `;
    for (const { id } of toBackfill) {
      const filePath = path.join(booksDir, id + '.epub');
      try {
        const meta = parseEpub(filePath);
        await prisma.$executeRaw`UPDATE books SET page_count = ${meta.pageCount} WHERE id = ${id}`;
      } catch {
        log.warn(`Data migration (page count): failed for book ${id}; leaving at 0`);
      }
    }
  });

  // Data migration: backfill chapter_count / chapter_spine_map / chapter_names
  // for books imported before chapter data extraction was introduced.
  await runDataMigration(prisma, 'data_v9_chapter_data', async () => {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    if (!cols.some((c) => c.name === 'chapter_count')) return; // pre-v4 schema, skip

    const toBackfill = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM books WHERE chapter_count = 0
    `;
    let backfilled = 0;
    for (const { id } of toBackfill) {
      const filePath = path.join(booksDir, id + '.epub');
      try {
        const meta = parseEpub(filePath);
        if (meta.chapterCount > 0) {
          const chapterSpineMap = JSON.stringify(meta.chapterSpineMap);
          const chapterNames = JSON.stringify(meta.chapterNames);
          await prisma.$executeRaw`
            UPDATE books
            SET chapter_count     = ${meta.chapterCount},
                chapter_spine_map = ${chapterSpineMap},
                chapter_names     = ${chapterNames}
            WHERE id = ${id}
          `;
          backfilled++;
        }
      } catch {
        log.warn(`Data migration (chapter data): failed for book ${id}; leaving at 0`);
      }
    }
    if (backfilled > 0) log.info(`Data migration (chapter data): backfilled ${backfilled} book(s)`);
  });

  // Data migration: per-user libraries. Renames filesystem-unsafe usernames,
  // rebuilds the book tables with composite (user_id, ...) primary keys, copies
  // every legacy book (rows + epub files) into every user's library, and removes
  // the legacy flat files. With zero users the legacy books are deleted outright.
  await runDataMigration(prisma, 'data_v11_per_user_libraries', async () => {
    const users = await prisma.$queryRaw<Array<{ id: string; username: string }>>`
      SELECT id, username FROM users ORDER BY username
    `;

    // 1. Rename filesystem-unsafe usernames (folder names derive from usernames).
    const taken = new Set(users.map((u) => u.username));
    for (const u of users) {
      if (isValidUsername(u.username)) continue;
      const base = sanitizeUsername(u.username);
      let candidate = base;
      let suffix = 2;
      while (taken.has(candidate)) candidate = `${base}-${suffix++}`;
      await prisma.$executeRaw`UPDATE users SET username = ${candidate} WHERE id = ${u.id}`;
      log.warn(
        `Per-user libraries: renamed user "${u.username}" to "${candidate}" (filesystem-unsafe username). ` +
          `KOReader sync and OPDS clients must update their username.`
      );
      taken.delete(u.username);
      taken.add(candidate);
      u.username = candidate;
    }

    // 2. Rebuild book tables with composite primary keys. FK enforcement off so
    // dropping the old tables doesn't cascade.
    await prisma.$executeRaw`PRAGMA foreign_keys = OFF`;

    await prisma.$executeRawUnsafe(`
      CREATE TABLE "books_new" (
        "user_id" TEXT NOT NULL,
        "id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "title_sort" TEXT NOT NULL DEFAULT '',
        "author_sort" TEXT NOT NULL DEFAULT '',
        "publish_date" TEXT NOT NULL DEFAULT '',
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
        "page_count" INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY ("user_id", "id"),
        CONSTRAINT "books_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "book_thumbnails_new" (
        "user_id" TEXT NOT NULL,
        "book_id" TEXT NOT NULL,
        "width" INTEGER NOT NULL,
        "data" BLOB NOT NULL,
        "mime" TEXT NOT NULL,
        PRIMARY KEY ("user_id", "book_id", "width"),
        CONSTRAINT "book_thumbnails_user_id_book_id_fkey" FOREIGN KEY ("user_id", "book_id") REFERENCES "books" ("user_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "book_id_history_new" (
        "user_id" TEXT NOT NULL,
        "old_id" TEXT NOT NULL,
        "current_id" TEXT NOT NULL,
        "timestamp" REAL NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        "type" TEXT NOT NULL DEFAULT 'edit' CHECK (type IN ('edit', 'merge')),
        PRIMARY KEY ("user_id", "old_id")
      )
    `);

    // 3. Copy every legacy row once per user, and the epub files into per-user folders.
    // Legacy databases (and reduced test fixtures) may predate some book columns;
    // copy a column from the source table when present, otherwise fall back to the
    // books_new default so the INSERT is shape-agnostic.
    const bookCols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    const bookColSet = new Set(bookCols.map((c) => c.name));
    const COPY_COLUMNS: Array<{ name: string; fallback: string }> = [
      { name: 'title', fallback: `''` },
      { name: 'title_sort', fallback: `''` },
      { name: 'author_sort', fallback: `''` },
      { name: 'publish_date', fallback: `''` },
      { name: 'author', fallback: `''` },
      { name: 'description', fallback: `''` },
      { name: 'publisher', fallback: `''` },
      { name: 'series', fallback: `''` },
      { name: 'series_index', fallback: `0` },
      { name: 'identifiers', fallback: `'[]'` },
      { name: 'subjects', fallback: `'[]'` },
      { name: 'cover_data', fallback: `NULL` },
      { name: 'cover_mime', fallback: `NULL` },
      { name: 'size', fallback: `0` },
      { name: 'mtime', fallback: `0` },
      { name: 'added_at', fallback: `0` },
      { name: 'chapter_count', fallback: `0` },
      { name: 'chapter_spine_map', fallback: `'[]'` },
      { name: 'chapter_names', fallback: `NULL` },
      { name: 'page_count', fallback: `0` },
    ];
    const insertCols = ['user_id', 'id', ...COPY_COLUMNS.map((c) => c.name)].join(', ');
    const selectExprs = COPY_COLUMNS.map((c) =>
      bookColSet.has(c.name) ? c.name : c.fallback
    ).join(', ');
    const legacyBooks = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM books`;
    for (const u of users) {
      fs.mkdirSync(path.join(booksDir, u.username), { recursive: true });
      await prisma.$executeRawUnsafe(
        `INSERT INTO books_new (${insertCols})
         SELECT ?, id, ${selectExprs} FROM books`,
        u.id
      );
      await prisma.$executeRaw`
        INSERT INTO book_thumbnails_new (user_id, book_id, width, data, mime)
        SELECT ${u.id}, book_id, width, data, mime FROM book_thumbnails
      `;
      await prisma.$executeRaw`
        INSERT INTO book_id_history_new (user_id, old_id, current_id, timestamp, type)
        SELECT ${u.id}, old_id, current_id, timestamp, type FROM book_id_history
      `;
      for (const { id } of legacyBooks) {
        const src = path.join(booksDir, id + '.epub');
        const dest = path.join(booksDir, u.username, id + '.epub');
        try {
          fs.copyFileSync(src, dest);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            log.warn(
              `Per-user libraries: could not copy ${id}.epub for "${u.username}" (missing file)`
            );
          } else {
            throw err;
          }
        }
      }
    }

    await prisma.$executeRawUnsafe(`DROP TABLE "book_thumbnails"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "book_thumbnails_new" RENAME TO "book_thumbnails"`);
    await prisma.$executeRawUnsafe(`DROP TABLE "books"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "books_new" RENAME TO "books"`);
    await prisma.$executeRawUnsafe(`DROP TABLE "book_id_history"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "book_id_history_new" RENAME TO "book_id_history"`);

    await prisma.$executeRaw`PRAGMA foreign_keys = ON`;

    // 4. Remove legacy flat files — also when there are zero users (per spec,
    // the unreachable legacy library is deleted).
    for (const { id } of legacyBooks) {
      fs.rmSync(path.join(booksDir, id + '.epub'), { force: true });
    }
    if (legacyBooks.length > 0) {
      log.info(
        `Per-user libraries: distributed ${legacyBooks.length} book(s) to ${users.length} user(s)`
      );
    }
  });

  // Data migration: create the series table and add series_id to books.
  // This runs after data_v10_user_surrogate_id (which promotes users.id to PRIMARY KEY)
  // and data_v11_per_user_libraries (which rebuilds the books table).
  // The Prisma DDL migration (20260613200000_add_series_table) is a no-op; all the
  // real schema work happens here so the FK constraint on users(id) is valid.
  await runDataMigration(prisma, 'data_v12_series_table', async () => {
    await prisma.$executeRaw`PRAGMA foreign_keys = OFF`;

    // Create series table (idempotent — skip if already exists).
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "series" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "user_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "sort_key" TEXT NOT NULL,
        "subjects" TEXT NOT NULL DEFAULT '[]',
        "book_count" INTEGER NOT NULL DEFAULT 0,
        "author" TEXT NOT NULL DEFAULT '',
        "publisher" TEXT NOT NULL DEFAULT '',
        "total_pages" INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT "series_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "series_user_id_name_key" ON "series"("user_id", "name")
    `);

    // Add series_id column to books if not already present.
    const bookCols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    if (!bookCols.some((c) => c.name === 'series_id')) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "books" ADD COLUMN "series_id" TEXT REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE`
      );
    }

    // Backfill: create Series rows for all existing books with a non-empty series string.
    const booksWithSeries = await prisma.$queryRaw<Array<{ user_id: string; series: string }>>`
      SELECT DISTINCT user_id, series FROM books WHERE series != ''
    `;
    for (const { user_id, series } of booksWithSeries) {
      const existing = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM series WHERE user_id = ${user_id} AND name = ${series}
      `;
      const id = existing[0]?.id ?? crypto.randomUUID();
      if (existing.length === 0) {
        await prisma.$executeRaw`
          INSERT INTO series (id, user_id, name, sort_key) VALUES (${id}, ${user_id}, ${series}, ${series})
        `;
      }
      await prisma.$executeRaw`
        UPDATE books SET series_id = ${id} WHERE user_id = ${user_id} AND series = ${series}
      `;
    }

    await prisma.$executeRaw`PRAGMA foreign_keys = ON`;
    log.info('Data migration (series table): series table and series_id backfill complete');
  });

  // Data migration: backfill series aggregate fields (bookCount, subjects, author,
  // publisher, totalPages) for series rows that existed before these columns were added.
  await runDataMigration(prisma, 'data_v13_series_meta', async () => {
    // Add new columns to the series table if they don't already exist
    // (for databases that ran data_v12_series_table before this feature was added)
    const seriesCols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(series)`;
    const colNames = new Set(seriesCols.map((c) => c.name));
    if (!colNames.has('subjects')) {
      await prisma.$executeRaw`ALTER TABLE series ADD COLUMN subjects TEXT NOT NULL DEFAULT '[]'`;
    }
    if (!colNames.has('book_count')) {
      await prisma.$executeRaw`ALTER TABLE series ADD COLUMN book_count INTEGER NOT NULL DEFAULT 0`;
    }
    if (!colNames.has('author')) {
      await prisma.$executeRaw`ALTER TABLE series ADD COLUMN author TEXT NOT NULL DEFAULT ''`;
    }
    if (!colNames.has('publisher')) {
      await prisma.$executeRaw`ALTER TABLE series ADD COLUMN publisher TEXT NOT NULL DEFAULT ''`;
    }
    if (!colNames.has('total_pages')) {
      await prisma.$executeRaw`ALTER TABLE series ADD COLUMN total_pages INTEGER NOT NULL DEFAULT 0`;
    }

    const allSeries = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM series`;
    for (const { id: seriesId } of allSeries) {
      const books = await prisma.$queryRaw<
        Array<{ subjects: string; author: string; publisher: string; page_count: number }>
      >`SELECT subjects, author, publisher, page_count FROM books WHERE series_id = ${seriesId} ORDER BY added_at ASC, id ASC`;

      const bookCount = books.length;
      const totalPages = books.reduce((sum, b) => sum + b.page_count, 0);

      const seenSubjects = new Map<string, string>();
      for (const book of books) {
        let parsedSubjects: string[];
        try {
          const parsed: unknown = JSON.parse(book.subjects);
          parsedSubjects = Array.isArray(parsed) ? (parsed as string[]) : [];
        } catch {
          parsedSubjects = [];
        }
        for (const s of parsedSubjects) {
          const key = s.toLowerCase();
          if (!seenSubjects.has(key)) seenSubjects.set(key, s);
        }
      }
      const subjects = JSON.stringify(
        [...seenSubjects.values()].sort((a, b) => a.localeCompare(b))
      );

      const seenAuthors = new Map<string, string>();
      for (const book of books) {
        if (book.author) {
          const key = book.author.toLowerCase();
          if (!seenAuthors.has(key)) seenAuthors.set(key, book.author);
        }
      }
      const author = [...seenAuthors.values()].join(', ');

      const seenPublishers = new Map<string, string>();
      for (const book of books) {
        if (book.publisher) {
          const key = book.publisher.toLowerCase();
          if (!seenPublishers.has(key)) seenPublishers.set(key, book.publisher);
        }
      }
      const publisher = [...seenPublishers.values()].join(', ');

      await prisma.$executeRaw`
        UPDATE series
        SET subjects = ${subjects},
            book_count = ${bookCount},
            author = ${author},
            publisher = ${publisher},
            total_pages = ${totalPages}
        WHERE id = ${seriesId}
      `;
    }
    if (allSeries.length > 0) {
      log.info(`Data migration (series meta): backfilled ${allSeries.length} series`);
    }
  });
}

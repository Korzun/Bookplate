import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { parseEpub, partialMD5 } from '../services/epub-parser';
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
    let skipSql = false;
    if (migName === '0_baseline') {
      const existing = await prisma.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'books'
      `;
      skipSql = existing.length > 0;
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
}

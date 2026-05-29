import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { parseEpub, partialMD5 } from '../services/epub-parser';
import { logger } from '../logger';

const log = logger('Migrate');

/**
 * Runs all database migrations in order (v1–v9) and creates the users/progress
 * tables.  Safe to call on every startup — all steps are idempotent.
 *
 * PRAGMA calls that read or write session/header state are intentionally kept
 * outside Prisma transactions, since the SQLite adapter does not support them
 * inside a transaction context.
 */
export async function runMigrations(prisma: PrismaClient, booksDir: string): Promise<void> {
  // Enable FK enforcement for the lifetime of this connection so that ON DELETE
  // CASCADE / ON UPDATE CASCADE rules fire correctly at the database level.
  await prisma.$executeRaw`PRAGMA foreign_keys = ON`;

  // ── User-store tables ────────────────────────────────────────────────────────
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      key      TEXT NOT NULL
    )
  `;
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS progress (
      username   TEXT    NOT NULL,
      document   TEXT    NOT NULL,
      progress   TEXT    NOT NULL,
      percentage REAL    NOT NULL,
      device     TEXT    NOT NULL,
      device_id  TEXT    NOT NULL,
      timestamp  INTEGER NOT NULL,
      PRIMARY KEY (username, document)
    )
  `;

  // ── Base books table (original schema, pre-v3 columns) ───────────────────────
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS books (
      id            TEXT    PRIMARY KEY,
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
      added_at      INTEGER NOT NULL
    )
  `;

  // ── Pre-v1: ensure file_as column exists (added before versioning began) ─────
  const baseColumns = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
  if (!baseColumns.some((c) => c.name === 'file_as')) {
    await prisma.$executeRaw`ALTER TABLE books ADD COLUMN file_as TEXT NOT NULL DEFAULT ''`;
  }

  // ── Read current schema version ──────────────────────────────────────────────
  const versionRows = await prisma.$queryRaw<Array<{ user_version: number }>>`PRAGMA user_version`;
  const user_version = versionRows[0].user_version;

  // ── v2: recompute book IDs with corrected partial MD5 ───────────────────────
  // The original algorithm read 1 KiB starting at offset 256; the corrected one
  // reads from offset 0.  Only runs when the old `path` column still exists.
  if (user_version < 2) {
    const v2Cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    const hasPath = v2Cols.some((c) => c.name === 'path');
    const books = hasPath
      ? await prisma.$queryRaw<Array<{ id: string; path: string }>>`SELECT id, path FROM books`
      : [];

    const progressCheck = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'progress'
    `;
    const progressExists = progressCheck.length > 0;

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

    await prisma.$executeRawUnsafe('PRAGMA user_version = 2');
    if (recomputed > 0) log.info(`Migration v2: recomputed ${recomputed} book ID(s)`);
  }

  // ── v3: add publisher, identifiers, subjects columns ────────────────────────
  if (user_version < 3) {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has('publisher')) {
      await prisma.$executeRaw`ALTER TABLE books ADD COLUMN publisher TEXT NOT NULL DEFAULT ''`;
    }
    if (!colNames.has('identifiers')) {
      await prisma.$executeRaw`ALTER TABLE books ADD COLUMN identifiers TEXT NOT NULL DEFAULT '[]'`;
    }
    if (!colNames.has('subjects')) {
      await prisma.$executeRaw`ALTER TABLE books ADD COLUMN subjects TEXT NOT NULL DEFAULT '[]'`;
    }
    await prisma.$executeRawUnsafe('PRAGMA user_version = 3');
  }

  // ── v4: add chapter_count, chapter_spine_map columns ────────────────────────
  if (user_version < 4) {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has('chapter_count')) {
      await prisma.$executeRaw`ALTER TABLE books ADD COLUMN chapter_count INTEGER NOT NULL DEFAULT 0`;
    }
    if (!colNames.has('chapter_spine_map')) {
      await prisma.$executeRaw`ALTER TABLE books ADD COLUMN chapter_spine_map TEXT NOT NULL DEFAULT '[]'`;
    }
    await prisma.$executeRawUnsafe('PRAGMA user_version = 4');
  }

  // ── v5: add chapter_names column ─────────────────────────────────────────────
  if (user_version < 5) {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    if (!cols.some((c) => c.name === 'chapter_names')) {
      await prisma.$executeRaw`ALTER TABLE books ADD COLUMN chapter_names TEXT`;
    }
    await prisma.$executeRawUnsafe('PRAGMA user_version = 5');
  }

  // ── v6: create book_thumbnails table ─────────────────────────────────────────
  if (user_version < 6) {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS book_thumbnails (
        book_id  TEXT    NOT NULL REFERENCES books(id) ON DELETE CASCADE ON UPDATE CASCADE,
        width    INTEGER NOT NULL,
        data     BLOB    NOT NULL,
        mime     TEXT    NOT NULL,
        PRIMARY KEY (book_id, width)
      )
    `;
    await prisma.$executeRawUnsafe('PRAGMA user_version = 6');
  }

  // ── v7: canonicalize EPUB filenames and drop filename/path columns ───────────
  // Old schema stored arbitrary filenames; new schema uses `<id>.epub` exclusively.
  // Files are renamed on disk first, then the table is rebuilt inside a transaction
  // (the only way to drop columns in SQLite < 3.35).
  // PRAGMA foreign_keys must be toggled outside the transaction.
  if (user_version < 7) {
    const v7Cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    const hasFilename = v7Cols.some((c) => c.name === 'filename');
    const rows = hasFilename
      ? await prisma.$queryRaw<Array<{ id: string; filename: string; path: string }>>`
          SELECT id, filename, path FROM books
        `
      : [];

    // Rename files on disk before touching the DB so that a crash mid-rename
    // is recoverable: re-running will find the source gone (skip) or already
    // at the canonical path (no-op).
    for (const row of rows) {
      const canonical = path.join(booksDir, row.id + '.epub');
      const src = row.path && row.path.length > 0 ? row.path : path.join(booksDir, row.filename);

      if (!fs.existsSync(src)) {
        log.warn(`migration v7: source file missing for book ${row.id} (${src}); skipping rename`);
        continue;
      }
      if (path.resolve(src) === path.resolve(canonical)) {
        continue;
      }
      if (fs.existsSync(canonical)) {
        log.warn(
          `migration v7: canonical path ${canonical} already occupied; skipping rename for ${row.id}`
        );
        continue;
      }
      try {
        fs.renameSync(src, canonical);
      } catch (err: unknown) {
        log.warn(
          `migration v7: failed to rename ${src} → ${canonical}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (hasFilename) {
      // Disable FK enforcement while rebuilding (must be outside the transaction)
      await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          CREATE TABLE books_new (
            id                TEXT    PRIMARY KEY,
            title             TEXT    NOT NULL,
            file_as           TEXT    NOT NULL DEFAULT '',
            author            TEXT    NOT NULL DEFAULT '',
            description       TEXT    NOT NULL DEFAULT '',
            publisher         TEXT    NOT NULL DEFAULT '',
            series            TEXT    NOT NULL DEFAULT '',
            series_index      REAL    NOT NULL DEFAULT 0,
            identifiers       TEXT    NOT NULL DEFAULT '[]',
            subjects          TEXT    NOT NULL DEFAULT '[]',
            cover_data        BLOB,
            cover_mime        TEXT,
            size              INTEGER NOT NULL,
            mtime             INTEGER NOT NULL,
            added_at          INTEGER NOT NULL,
            chapter_count     INTEGER NOT NULL DEFAULT 0,
            chapter_spine_map TEXT    NOT NULL DEFAULT '[]',
            chapter_names     TEXT
          )
        `;
        await tx.$executeRaw`
          INSERT INTO books_new (
            id, title, file_as, author, description, publisher, series,
            series_index, identifiers, subjects, cover_data, cover_mime,
            size, mtime, added_at, chapter_count, chapter_spine_map, chapter_names
          )
          SELECT
            id, title, file_as, author, description, publisher, series,
            series_index, identifiers, subjects, cover_data, cover_mime,
            size, mtime, added_at, chapter_count, chapter_spine_map, chapter_names
          FROM books
        `;
        await tx.$executeRaw`DROP TABLE books`;
        await tx.$executeRaw`ALTER TABLE books_new RENAME TO books`;
      });
      await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
      log.info(
        `Migration v7: canonicalized ${rows.length} book file(s); dropped filename/path columns`
      );
    }

    await prisma.$executeRawUnsafe('PRAGMA user_version = 7');
  }

  // ── v8: add page_count column and backfill from epub parsing ─────────────────
  if (user_version < 8) {
    const v8Cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(books)`;
    if (!v8Cols.some((c) => c.name === 'page_count')) {
      await prisma.$executeRaw`ALTER TABLE books ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0`;
    }
    const toBackfill = await prisma.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM books WHERE page_count = 0`;
    for (const { id } of toBackfill) {
      const filePath = path.join(booksDir, id + '.epub');
      try {
        const meta = parseEpub(filePath);
        await prisma.$executeRaw`UPDATE books SET page_count = ${meta.pageCount} WHERE id = ${id}`;
      } catch {
        log.warn(`Migration v8: failed to compute page count for book ${id}; leaving at 0`);
      }
    }
    await prisma.$executeRawUnsafe('PRAGMA user_version = 8');
  }

  // ── v9: backfill chapter_count / chapter_spine_map / chapter_names ───────────
  if (user_version < 9) {
    const toBackfill = await prisma.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM books WHERE chapter_count = 0`;
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
        log.warn(`Migration v9: failed to compute chapter data for book ${id}; leaving at 0`);
      }
    }
    await prisma.$executeRawUnsafe('PRAGMA user_version = 9');
    if (backfilled > 0) log.info(`Migration v9: backfilled chapter data for ${backfilled} book(s)`);
  }
}

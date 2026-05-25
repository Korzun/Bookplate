import * as fs from 'fs';
import * as path from 'path';
import { Database as DB } from 'better-sqlite3';
import { Book, EpubMeta } from '../types';
import { parseEpub, partialMD5 } from './epub-parser';
import { logger } from '../logger';
import { downloadFilename } from '../utils/download-filename';

const log = logger('BookStore');

export class BookHashCollisionError extends Error {
  constructor(public readonly collidingId: string) {
    super(`Book hash collision: edited content matches existing book "${collidingId}"`);
    this.name = 'BookHashCollisionError';
  }
}

export class BookAlreadyExistsError extends Error {
  constructor(public readonly existingId: string) {
    super(`Book with id "${existingId}" already exists in the library`);
    this.name = 'BookAlreadyExistsError';
  }
}

interface BookRow {
  id: string;
  title: string;
  file_as: string;
  author: string;
  description: string;
  publisher: string;
  series: string;
  series_index: number;
  identifiers: string; // JSON string
  subjects: string; // JSON string
  has_cover: number;
  chapter_count: number;
  chapter_spine_map: string;
  chapter_names: string | null;
  size: number;
  mtime: number;
  added_at: number;
  page_count: number;
}

export interface ScanImporter {
  parseEpub: (filePath: string) => EpubMeta;
  partialMD5: (filePath: string) => string;
}

const defaultImporter: ScanImporter = { parseEpub, partialMD5 };

export class BookStore {
  private readonly db: DB;

  constructor(
    private readonly booksDir: string,
    db: DB
  ) {
    this.db = db;
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  getBooksDir(): string {
    return this.booksDir;
  }

  private migrate(): void {
    this.db.exec(`
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
    `);

    const columns = this.db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'file_as')) {
      this.db.exec(`ALTER TABLE books ADD COLUMN file_as TEXT NOT NULL DEFAULT ''`);
    }

    // Migration v2: recompute book IDs with corrected partial MD5 (first offset was 256, now 0)
    const { user_version } = this.db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (user_version < 2) {
      const v2Cols = this.db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
      const hasPath = v2Cols.some((c) => c.name === 'path');
      const books = hasPath
        ? (this.db.prepare('SELECT id, path FROM books').all() as {
            id: string;
            path: string;
          }[])
        : [];
      const updateBook = this.db.prepare('UPDATE books SET id = ? WHERE id = ?');
      const progressExists = this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='progress'")
        .get();
      const updateProgress = progressExists
        ? this.db.prepare('UPDATE progress SET document = ? WHERE document = ?')
        : null;

      let recomputed = 0;
      this.db.transaction(() => {
        for (const book of books) {
          let newId: string;
          try {
            newId = partialMD5(book.path);
          } catch {
            continue;
          }
          if (newId !== book.id) {
            updateBook.run(newId, book.id);
            updateProgress?.run(newId, book.id);
            recomputed++;
          }
        }
      })();
      this.db.exec('PRAGMA user_version = 2');
      if (recomputed > 0) log.info(`Migration v2: recomputed ${recomputed} book ID(s)`);
    }

    if (user_version < 3) {
      const cols = this.db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has('publisher')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN publisher TEXT NOT NULL DEFAULT ''`);
      }
      if (!colNames.has('identifiers')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN identifiers TEXT NOT NULL DEFAULT '[]'`);
      }
      if (!colNames.has('subjects')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN subjects TEXT NOT NULL DEFAULT '[]'`);
      }
      this.db.exec('PRAGMA user_version = 3');
    }

    if (user_version < 4) {
      const cols = this.db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has('chapter_count')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN chapter_count INTEGER NOT NULL DEFAULT 0`);
      }
      if (!colNames.has('chapter_spine_map')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN chapter_spine_map TEXT NOT NULL DEFAULT '[]'`);
      }
      this.db.exec('PRAGMA user_version = 4');
    }

    if (user_version < 5) {
      const cols = this.db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'chapter_names')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN chapter_names TEXT`);
      }
      this.db.exec('PRAGMA user_version = 5');
    }

    if (user_version < 6) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS book_thumbnails (
          book_id  TEXT    NOT NULL REFERENCES books(id) ON DELETE CASCADE ON UPDATE CASCADE,
          width    INTEGER NOT NULL,
          data     BLOB    NOT NULL,
          mime     TEXT    NOT NULL,
          PRIMARY KEY (book_id, width)
        )
      `);
      this.db.exec('PRAGMA user_version = 6');
    }

    if (user_version < 7) {
      const v7Cols = this.db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
      const hasFilename = v7Cols.some((c) => c.name === 'filename');
      const rows = hasFilename
        ? (this.db.prepare('SELECT id, filename, path FROM books').all() as Array<{
            id: string;
            filename: string;
            path: string;
          }>)
        : [];

      for (const row of rows) {
        const canonical = path.join(this.booksDir, row.id + '.epub');
        const src =
          row.path && row.path.length > 0 ? row.path : path.join(this.booksDir, row.filename);

        if (!fs.existsSync(src)) {
          log.warn(
            `migration v7: source file missing for book ${row.id} (${src}); skipping rename`
          );
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
        this.db.exec('PRAGMA foreign_keys=OFF');
        this.db.transaction(() => {
          this.db.exec(`
            CREATE TABLE books_new (
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
              added_at      INTEGER NOT NULL,
              chapter_count INTEGER NOT NULL DEFAULT 0,
              chapter_spine_map TEXT NOT NULL DEFAULT '[]',
              chapter_names TEXT
            );
            INSERT INTO books_new (id, title, file_as, author, description, publisher, series,
                                   series_index, identifiers, subjects, cover_data, cover_mime,
                                   size, mtime, added_at, chapter_count, chapter_spine_map, chapter_names)
            SELECT id, title, file_as, author, description, publisher, series, series_index,
                   identifiers, subjects, cover_data, cover_mime, size, mtime, added_at,
                   chapter_count, chapter_spine_map, chapter_names
            FROM books;
            DROP TABLE books;
            ALTER TABLE books_new RENAME TO books;
          `);
          this.db.exec('PRAGMA user_version = 7');
        })();
        this.db.exec('PRAGMA foreign_keys=ON');
        log.info(
          `Migration v7: canonicalized ${rows.length} book file(s); dropped filename/path columns`
        );
      } else {
        this.db.exec('PRAGMA user_version = 7');
      }
    }

    if (user_version < 8) {
      const v8Cols = this.db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>;
      if (!v8Cols.some((c) => c.name === 'page_count')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0`);
      }
      const toBackfill = this.db
        .prepare('SELECT id FROM books WHERE page_count = 0')
        .all() as Array<{ id: string }>;
      const updatePageCount = this.db.prepare('UPDATE books SET page_count = ? WHERE id = ?');
      for (const { id } of toBackfill) {
        const filePath = path.join(this.booksDir, id + '.epub');
        try {
          const meta = parseEpub(filePath);
          updatePageCount.run(meta.pageCount, id);
        } catch {
          log.warn(`Migration v8: failed to compute page count for book ${id}; leaving at 0`);
        }
      }
      this.db.exec('PRAGMA user_version = 8');
    }

    if (user_version < 9) {
      const toBackfill = this.db
        .prepare('SELECT id FROM books WHERE chapter_count = 0')
        .all() as Array<{ id: string }>;
      const updateChapterData = this.db.prepare(
        'UPDATE books SET chapter_count = ?, chapter_spine_map = ?, chapter_names = ? WHERE id = ?'
      );
      let backfilled = 0;
      for (const { id } of toBackfill) {
        const filePath = path.join(this.booksDir, id + '.epub');
        try {
          const meta = parseEpub(filePath);
          if (meta.chapterCount > 0) {
            updateChapterData.run(
              meta.chapterCount,
              JSON.stringify(meta.chapterSpineMap),
              JSON.stringify(meta.chapterNames),
              id
            );
            backfilled++;
          }
        } catch {
          log.warn(`Migration v9: failed to compute chapter data for book ${id}; leaving at 0`);
        }
      }
      this.db.exec('PRAGMA user_version = 9');
      if (backfilled > 0)
        log.info(`Migration v9: backfilled chapter data for ${backfilled} book(s)`);
    }
  }

  addBook(id: string, srcPath: string, meta: EpubMeta): void {
    const existing = this.db.prepare('SELECT 1 FROM books WHERE id = ?').get(id);
    if (existing) {
      throw new BookAlreadyExistsError(id);
    }

    const targetPath = path.join(this.booksDir, id + '.epub');
    if (path.resolve(srcPath) !== path.resolve(targetPath)) {
      fs.renameSync(srcPath, targetPath);
    }

    const stat = fs.statSync(targetPath);
    const title = meta.title.trim();
    const fileAs = (meta.fileAs || '').trim();

    this.db
      .prepare(
        `
      INSERT INTO books (id, title, file_as, author, description, publisher,
                         series, series_index, identifiers, subjects, cover_data, cover_mime,
                         size, mtime, added_at, chapter_count, chapter_spine_map, chapter_names,
                         page_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        id,
        title,
        fileAs,
        meta.author,
        meta.description,
        meta.publisher,
        meta.series,
        meta.seriesIndex,
        JSON.stringify(meta.identifiers),
        JSON.stringify(meta.subjects),
        meta.coverData,
        meta.coverMime,
        stat.size,
        stat.mtimeMs,
        Date.now(),
        meta.chapterCount,
        JSON.stringify(meta.chapterSpineMap),
        JSON.stringify(meta.chapterNames),
        meta.pageCount
      );
  }

  listBooks(): Book[] {
    const rows = this.db
      .prepare(
        `
      SELECT id, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map, chapter_names, page_count
      FROM books
      ORDER BY CASE WHEN file_as != '' THEN file_as ELSE title END, title, id
    `
      )
      .all() as BookRow[];
    return rows.map((r) => this.rowToBook(r));
  }

  getBookById(id: string): Book | null {
    const row = this.db
      .prepare(
        `
      SELECT id, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map, chapter_names, page_count
      FROM books WHERE id = ?
    `
      )
      .get(id) as BookRow | undefined;
    return row ? this.rowToBook(row) : null;
  }

  deleteBook(id: string): Book | null {
    const book = this.getBookById(id);
    if (!book) return null;
    try {
      fs.unlinkSync(book.path);
    } catch {
      /* file already gone */
    }
    this.db.prepare('DELETE FROM books WHERE id = ?').run(id);
    return book;
  }

  reimportBook(id: string, importer: ScanImporter = defaultImporter): Book | null {
    const exists = this.db.prepare('SELECT 1 FROM books WHERE id = ?').get(id);
    if (!exists) return null;

    const filePath = path.join(this.booksDir, id + '.epub');
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return null;
    }
    const meta = importer.parseEpub(filePath);
    const newId = importer.partialMD5(filePath);

    const progressExists = this.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='progress'")
      .get();

    if (newId !== id && this.db.prepare('SELECT 1 FROM books WHERE id = ?').get(newId)) {
      throw new BookHashCollisionError(newId);
    }

    this.db.transaction(() => {
      if (newId !== id) {
        const oldPath = path.join(this.booksDir, id + '.epub');
        const newPath = path.join(this.booksDir, newId + '.epub');
        if (oldPath !== newPath) {
          fs.renameSync(oldPath, newPath);
        }
        this.db
          .prepare(
            `UPDATE books SET id=?, title=?, file_as=?, author=?, description=?, publisher=?,
             series=?, series_index=?, identifiers=?, subjects=?, cover_data=?, cover_mime=?,
             size=?, mtime=?, chapter_count=?, chapter_spine_map=?, chapter_names=?, page_count=? WHERE id=?`
          )
          .run(
            newId,
            meta.title.trim(),
            (meta.fileAs || '').trim(),
            meta.author,
            meta.description,
            meta.publisher,
            meta.series,
            meta.seriesIndex,
            JSON.stringify(meta.identifiers),
            JSON.stringify(meta.subjects),
            meta.coverData,
            meta.coverMime,
            stat.size,
            stat.mtime.getTime(),
            meta.chapterCount,
            JSON.stringify(meta.chapterSpineMap),
            JSON.stringify(meta.chapterNames),
            meta.pageCount,
            id
          );
        if (progressExists) {
          // For users with progress under both ids, keep whichever record is newer
          type Conflict = { username: string; old_ts: number; new_ts: number };
          const conflicts = this.db
            .prepare(
              `SELECT p1.username, p1.timestamp AS old_ts, p2.timestamp AS new_ts
               FROM progress p1
               JOIN progress p2 ON p1.username = p2.username AND p2.document = ?
               WHERE p1.document = ?`
            )
            .all(newId, id) as Conflict[];
          for (const c of conflicts) {
            if (c.old_ts >= c.new_ts) {
              this.db
                .prepare('DELETE FROM progress WHERE username = ? AND document = ?')
                .run(c.username, newId);
            } else {
              this.db
                .prepare('DELETE FROM progress WHERE username = ? AND document = ?')
                .run(c.username, id);
            }
          }
          this.db.prepare('UPDATE progress SET document=? WHERE document=?').run(newId, id);
        }
      } else {
        this.db
          .prepare(
            `UPDATE books SET title=?, file_as=?, author=?, description=?, publisher=?,
             series=?, series_index=?, identifiers=?, subjects=?, cover_data=?, cover_mime=?,
             size=?, mtime=?, chapter_count=?, chapter_spine_map=?, chapter_names=?, page_count=? WHERE id=?`
          )
          .run(
            meta.title.trim(),
            (meta.fileAs || '').trim(),
            meta.author,
            meta.description,
            meta.publisher,
            meta.series,
            meta.seriesIndex,
            JSON.stringify(meta.identifiers),
            JSON.stringify(meta.subjects),
            meta.coverData,
            meta.coverMime,
            stat.size,
            stat.mtime.getTime(),
            meta.chapterCount,
            JSON.stringify(meta.chapterSpineMap),
            JSON.stringify(meta.chapterNames),
            meta.pageCount,
            id
          );
      }
    })();

    return this.getBookById(newId);
  }

  private removeStaleBook(id: string): void {
    this.db.prepare('DELETE FROM books WHERE id = ?').run(id);
  }

  getCover(id: string): { data: Buffer; mime: string } | null {
    const row = this.db.prepare('SELECT cover_data, cover_mime FROM books WHERE id = ?').get(id) as
      | { cover_data: Buffer | null; cover_mime: string | null }
      | undefined;
    if (!row || !row.cover_data) return null;
    return { data: row.cover_data as Buffer, mime: row.cover_mime as string };
  }

  saveThumbnail(bookId: string, width: number, data: Buffer, mime: string): void {
    this.db
      .prepare(
        `INSERT INTO book_thumbnails (book_id, width, data, mime) VALUES (?, ?, ?, ?)
         ON CONFLICT (book_id, width) DO UPDATE SET data = excluded.data, mime = excluded.mime`
      )
      .run(bookId, width, data, mime);
  }

  getThumbnail(bookId: string, width: number): { data: Buffer; mime: string } | null {
    const row = this.db
      .prepare('SELECT data, mime FROM book_thumbnails WHERE book_id = ? AND width = ?')
      .get(bookId, width) as { data: Buffer; mime: string } | undefined;
    return row ?? null;
  }

  pruneThumbnails(configuredWidths: number[]): number {
    if (configuredWidths.length === 0) {
      return this.db.prepare('DELETE FROM book_thumbnails').run().changes;
    }
    const placeholders = configuredWidths.map(() => '?').join(', ');
    return this.db
      .prepare(`DELETE FROM book_thumbnails WHERE width NOT IN (${placeholders})`)
      .run(...configuredWidths).changes;
  }

  getMissingThumbnailPairs(widths: number[]): Array<{ bookId: string; width: number }> {
    const result: Array<{ bookId: string; width: number }> = [];
    const stmt = this.db.prepare(
      `SELECT id AS bookId FROM books
       WHERE cover_data IS NOT NULL
         AND id NOT IN (SELECT book_id FROM book_thumbnails WHERE width = ?)`
    );
    for (const width of widths) {
      const rows = stmt.all(width) as { bookId: string }[];
      for (const { bookId } of rows) {
        result.push({ bookId, width });
      }
    }
    return result;
  }

  scan(importer: ScanImporter = defaultImporter): { imported: string[]; removed: string[] } {
    const imported: string[] = [];
    const removed: string[] = [];

    const dbIds = new Set(
      (this.db.prepare('SELECT id FROM books').all() as Array<{ id: string }>).map((r) => r.id)
    );

    const diskFilenames: string[] = fs.existsSync(this.booksDir)
      ? fs.readdirSync(this.booksDir).filter((f) => path.extname(f).toLowerCase() === '.epub')
      : [];

    for (const filename of diskFilenames) {
      const filePath = path.join(this.booksDir, filename);
      const stem = path.basename(filename, '.epub');

      // Fast path: file already at <id>.epub and that id is imported.
      if (/^[0-9a-f]{32}$/.test(stem) && dbIds.has(stem)) {
        continue;
      }

      let id: string;
      let meta: EpubMeta;
      try {
        id = importer.partialMD5(filePath);
        meta = importer.parseEpub(filePath);
      } catch (err: unknown) {
        log.warn(
          `scan: skipping "${filename}" — ${err instanceof Error ? err.message : String(err)}`
        );
        continue;
      }

      const canonicalPath = path.join(this.booksDir, id + '.epub');
      if (filePath !== canonicalPath) {
        if (fs.existsSync(canonicalPath)) {
          log.warn(`scan: skipping "${filename}" — canonical path ${id}.epub already occupied`);
          continue;
        }
        fs.renameSync(filePath, canonicalPath);
      }

      if (dbIds.has(id)) {
        // Rename above was the only thing to do.
        continue;
      }

      try {
        const titleFallback = meta.title.trim() || path.basename(filename, path.extname(filename));
        this.addBook(id, canonicalPath, { ...meta, title: titleFallback });
        dbIds.add(id);
        imported.push(filename);
      } catch (err: unknown) {
        log.warn(
          `scan: skipping "${filename}" — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Stale rows: in DB but their canonical file is missing.
    const allIds = (this.db.prepare('SELECT id FROM books').all() as Array<{ id: string }>).map(
      (r) => r.id
    );
    for (const id of allIds) {
      const canonicalPath = path.join(this.booksDir, id + '.epub');
      if (!fs.existsSync(canonicalPath)) {
        this.removeStaleBook(id);
        removed.push(id + '.epub');
      }
    }

    return { imported, removed };
  }

  private rowToBook(r: BookRow): Book {
    const fileAs = r.file_as;
    return {
      id: r.id,
      filename: downloadFilename({
        author: r.author,
        series: r.series,
        seriesIndex: r.series_index,
        title: r.title,
      }),
      path: path.join(this.booksDir, r.id + '.epub'),
      title: r.title,
      fileAs,
      author: r.author,
      description: r.description,
      publisher: r.publisher,
      series: r.series,
      seriesIndex: r.series_index,
      identifiers: JSON.parse(r.identifiers) as { scheme: string; value: string }[],
      subjects: JSON.parse(r.subjects) as string[],
      hasCover: Boolean(r.has_cover),
      size: r.size,
      mtime: new Date(r.mtime),
      addedAt: new Date(r.added_at),
      chapterCount: r.chapter_count,
      chapterSpineMap: JSON.parse(r.chapter_spine_map) as number[],
      chapterNames: r.chapter_names ? (JSON.parse(r.chapter_names) as string[]) : [],
      pageCount: r.page_count,
    };
  }
}

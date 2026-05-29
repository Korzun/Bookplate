import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
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
  constructor(
    private readonly booksDir: string,
    private readonly prisma: PrismaClient
  ) {}

  getBooksDir(): string {
    return this.booksDir;
  }

  async listBooks(): Promise<Book[]> {
    const rows = await this.prisma.$queryRaw<BookRow[]>`
      SELECT id, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map, chapter_names, page_count
      FROM books
      ORDER BY CASE WHEN file_as != '' THEN file_as ELSE title END, title, id
    `;
    return rows.map((r) => this.rowToBook(r));
  }

  async getBookById(id: string): Promise<Book | null> {
    const rows = await this.prisma.$queryRaw<BookRow[]>`
      SELECT id, title, file_as, author, description, publisher, series, series_index,
             identifiers, subjects, cover_data IS NOT NULL AS has_cover, size, mtime, added_at,
             chapter_count, chapter_spine_map, chapter_names, page_count
      FROM books WHERE id = ${id}
    `;
    return rows.length > 0 ? this.rowToBook(rows[0]) : null;
  }

  async addBook(id: string, srcPath: string, meta: EpubMeta): Promise<void> {
    const existing = await this.prisma.book.findUnique({ where: { id }, select: { id: true } });
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

    await this.prisma.book.create({
      data: {
        id,
        title,
        fileAs,
        author: meta.author,
        description: meta.description,
        publisher: meta.publisher,
        series: meta.series,
        seriesIndex: meta.seriesIndex,
        identifiers: JSON.stringify(meta.identifiers),
        subjects: JSON.stringify(meta.subjects),
        coverData: meta.coverData as unknown as Prisma.Bytes | null,
        coverMime: meta.coverMime,
        size: stat.size,
        mtime: stat.mtimeMs,
        addedAt: Date.now(),
        chapterCount: meta.chapterCount,
        chapterSpineMap: JSON.stringify(meta.chapterSpineMap),
        chapterNames: JSON.stringify(meta.chapterNames),
        pageCount: meta.pageCount,
      },
    });
  }

  async deleteBook(id: string): Promise<Book | null> {
    const book = await this.getBookById(id);
    if (!book) return null;
    try {
      fs.unlinkSync(book.path);
    } catch {
      /* file already gone */
    }
    try {
      await this.prisma.book.delete({ where: { id } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025')) throw err;
    }
    return book;
  }

  async reimportBook(id: string, importer: ScanImporter = defaultImporter): Promise<Book | null> {
    const exists = await this.prisma.book.findUnique({ where: { id }, select: { id: true } });
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

    if (newId !== id) {
      const collision = await this.prisma.book.findUnique({
        where: { id: newId },
        select: { id: true },
      });
      if (collision) {
        throw new BookHashCollisionError(newId);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (newId !== id) {
        const oldPath = path.join(this.booksDir, id + '.epub');
        const newPath = path.join(this.booksDir, newId + '.epub');
        if (oldPath !== newPath) {
          fs.renameSync(oldPath, newPath);
        }

        await tx.$executeRaw`
          UPDATE books SET
            id=${newId},
            title=${meta.title.trim()},
            file_as=${(meta.fileAs || '').trim()},
            author=${meta.author},
            description=${meta.description},
            publisher=${meta.publisher},
            series=${meta.series},
            series_index=${meta.seriesIndex},
            identifiers=${JSON.stringify(meta.identifiers)},
            subjects=${JSON.stringify(meta.subjects)},
            cover_data=${meta.coverData},
            cover_mime=${meta.coverMime},
            size=${stat.size},
            mtime=${stat.mtimeMs},
            chapter_count=${meta.chapterCount},
            chapter_spine_map=${JSON.stringify(meta.chapterSpineMap)},
            chapter_names=${JSON.stringify(meta.chapterNames)},
            page_count=${meta.pageCount}
          WHERE id=${id}
        `;

        // For users with progress under both ids, keep whichever record is newer
        const conflicts = await tx.$queryRaw<
          Array<{ username: string; old_ts: number; new_ts: number }>
        >`
          SELECT p1.username, p1.timestamp AS old_ts, p2.timestamp AS new_ts
          FROM progress p1
          JOIN progress p2 ON p1.username = p2.username AND p2.document = ${newId}
          WHERE p1.document = ${id}
        `;
        for (const c of conflicts) {
          if (c.old_ts >= c.new_ts) {
            await tx.$executeRaw`DELETE FROM progress WHERE username = ${c.username} AND document = ${newId}`;
          } else {
            await tx.$executeRaw`DELETE FROM progress WHERE username = ${c.username} AND document = ${id}`;
          }
        }
        await tx.$executeRaw`UPDATE progress SET document=${newId} WHERE document=${id}`;
      } else {
        await tx.$executeRaw`
          UPDATE books SET
            title=${meta.title.trim()},
            file_as=${(meta.fileAs || '').trim()},
            author=${meta.author},
            description=${meta.description},
            publisher=${meta.publisher},
            series=${meta.series},
            series_index=${meta.seriesIndex},
            identifiers=${JSON.stringify(meta.identifiers)},
            subjects=${JSON.stringify(meta.subjects)},
            cover_data=${meta.coverData},
            cover_mime=${meta.coverMime},
            size=${stat.size},
            mtime=${stat.mtimeMs},
            chapter_count=${meta.chapterCount},
            chapter_spine_map=${JSON.stringify(meta.chapterSpineMap)},
            chapter_names=${JSON.stringify(meta.chapterNames)},
            page_count=${meta.pageCount}
          WHERE id=${id}
        `;
      }
    });

    return this.getBookById(newId);
  }

  private async removeStaleBook(id: string): Promise<void> {
    try {
      await this.prisma.book.delete({ where: { id } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025')) throw err;
    }
  }

  async getCover(id: string): Promise<{ data: Buffer; mime: string } | null> {
    const row = await this.prisma.book.findUnique({
      where: { id },
      select: { coverData: true, coverMime: true },
    });
    if (!row || !row.coverData) return null;
    // Prisma returns BLOB columns as Uint8Array; Buffer.from() ensures Express sends binary
    return { data: Buffer.from(row.coverData), mime: row.coverMime as string };
  }

  async saveThumbnail(bookId: string, width: number, data: Buffer, mime: string): Promise<void> {
    await this.prisma.bookThumbnail.upsert({
      where: { bookId_width: { bookId, width } },
      update: { data: data as unknown as Prisma.Bytes, mime },
      create: { bookId, width, data: data as unknown as Prisma.Bytes, mime },
    });
  }

  async getThumbnail(
    bookId: string,
    width: number
  ): Promise<{ data: Buffer; mime: string } | null> {
    const row = await this.prisma.bookThumbnail.findUnique({
      where: { bookId_width: { bookId, width } },
    });
    // Prisma returns BLOB columns as Uint8Array; Buffer.from() ensures Express sends binary
    return row ? { data: Buffer.from(row.data), mime: row.mime } : null;
  }

  async pruneThumbnails(configuredWidths: number[]): Promise<number> {
    if (configuredWidths.length === 0) {
      const result = await this.prisma.bookThumbnail.deleteMany({});
      return result.count;
    }
    const result = await this.prisma.bookThumbnail.deleteMany({
      where: { width: { notIn: configuredWidths } },
    });
    return result.count;
  }

  async getMissingThumbnailPairs(
    widths: number[]
  ): Promise<Array<{ bookId: string; width: number }>> {
    const result: Array<{ bookId: string; width: number }> = [];
    for (const width of widths) {
      const rows = await this.prisma.$queryRaw<Array<{ bookId: string }>>`
        SELECT id AS bookId FROM books
        WHERE cover_data IS NOT NULL
          AND id NOT IN (SELECT book_id FROM book_thumbnails WHERE width = ${width})
      `;
      for (const { bookId } of rows) {
        result.push({ bookId, width });
      }
    }
    return result;
  }

  async scan(
    importer: ScanImporter = defaultImporter
  ): Promise<{ imported: string[]; removed: string[] }> {
    const imported: string[] = [];
    const removed: string[] = [];

    const dbIdRows = await this.prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM books`;
    const dbIds = new Set(dbIdRows.map((r) => r.id));

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
        await this.addBook(id, canonicalPath, { ...meta, title: titleFallback });
        dbIds.add(id);
        imported.push(filename);
      } catch (err: unknown) {
        log.warn(
          `scan: skipping "${filename}" — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Stale rows: in DB but their canonical file is missing.
    const allIdRows = await this.prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM books`;
    for (const { id } of allIdRows) {
      const canonicalPath = path.join(this.booksDir, id + '.epub');
      if (!fs.existsSync(canonicalPath)) {
        await this.removeStaleBook(id);
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

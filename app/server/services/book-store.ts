import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { Book, EpubMeta } from '../types';
import { parseEpub, partialMD5 } from './epub-parser';
import { logger } from '../logger';
import { downloadFilename } from '../utils/download-filename';

const log = logger('BookStore');

// All book columns except coverData (binary blob); coverMime serves as the hasCover proxy.
const BOOK_SELECT = {
  id: true,
  title: true,
  fileAs: true,
  author: true,
  description: true,
  publisher: true,
  series: true,
  seriesIndex: true,
  identifiers: true,
  subjects: true,
  coverMime: true,
  size: true,
  mtime: true,
  addedAt: true,
  chapterCount: true,
  chapterSpineMap: true,
  chapterNames: true,
  pageCount: true,
} as const;

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
    const rows = await this.prisma.book.findMany({ select: BOOK_SELECT });
    // Replicate: ORDER BY CASE WHEN file_as != '' THEN file_as ELSE title END, title, id
    rows.sort((a, b) => {
      const aKey = a.fileAs !== '' ? a.fileAs : a.title;
      const bKey = b.fileAs !== '' ? b.fileAs : b.title;
      if (aKey < bKey) return -1;
      if (aKey > bKey) return 1;
      if (a.title < b.title) return -1;
      if (a.title > b.title) return 1;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    return rows.map((r) => this.prismaBookToBook(r));
  }

  async getBookById(id: string): Promise<Book | null> {
    const row = await this.prisma.book.findUnique({ where: { id }, select: BOOK_SELECT });
    return row ? this.prismaBookToBook(row) : null;
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

  async resolveBookId(id: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ current_id: string }>>`
      SELECT current_id FROM book_id_history WHERE old_id = ${id}
    `;
    return rows.length > 0 ? rows[0].current_id : id;
  }

  async getBookLineage(id: string): Promise<{
    currentId: string;
    entries: { oldId: string; newId: string; timestamp: number }[];
  } | null> {
    const book = await this.prisma.book.findUnique({ where: { id }, select: { id: true } });
    if (!book) return null;

    const rows = await this.prisma.$queryRaw<Array<{ old_id: string; timestamp: number }>>`
      SELECT old_id, timestamp FROM book_id_history
      WHERE current_id = ${id}
      ORDER BY timestamp DESC
    `;

    const entries = rows.map((row, i, arr) => ({
      oldId: row.old_id,
      newId: i === 0 ? id : arr[i - 1].old_id,
      timestamp: row.timestamp,
    }));

    return { currentId: id, entries };
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
    await this.prisma
      .$executeRaw`DELETE FROM book_id_history WHERE old_id = ${id} OR current_id = ${id}`;
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

        // Update the book row (and cascade-update thumbnails via the FK onUpdate: Cascade).
        await tx.book.update({
          where: { id },
          data: {
            id: newId,
            title: meta.title.trim(),
            fileAs: (meta.fileAs || '').trim(),
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
            chapterCount: meta.chapterCount,
            chapterSpineMap: JSON.stringify(meta.chapterSpineMap),
            chapterNames: JSON.stringify(meta.chapterNames),
            pageCount: meta.pageCount,
          },
        });

        // Progress has no FK to books, so migrate it manually.
        // First collect all progress records for both ids so we can resolve conflicts in JS.
        const oldProgresses = await tx.progress.findMany({ where: { document: id } });
        const newProgresses = await tx.progress.findMany({ where: { document: newId } });
        const newProgressByUsername = new Map(newProgresses.map((p) => [p.username, p]));

        // Determine which old-id records to carry forward after resolving per-user conflicts.
        const keptOldProgresses: typeof oldProgresses = [];
        for (const oldP of oldProgresses) {
          const newP = newProgressByUsername.get(oldP.username);
          if (newP) {
            if (oldP.timestamp >= newP.timestamp) {
              // Old record wins: remove the new-id duplicate so we can recreate it below.
              await tx.progress.delete({
                where: { username_document: { username: oldP.username, document: newId } },
              });
              keptOldProgresses.push(oldP);
            }
            // else: new-id record wins; the old-id record is dropped in the deleteMany below.
          } else {
            keptOldProgresses.push(oldP);
          }
        }

        // Remove all old-id progress records, then recreate the winners under the new id.
        await tx.progress.deleteMany({ where: { document: id } });
        if (keptOldProgresses.length > 0) {
          await tx.progress.createMany({
            data: keptOldProgresses.map((p) => ({
              username: p.username,
              document: newId,
              progress: p.progress,
              percentage: p.percentage,
              device: p.device,
              deviceId: p.deviceId,
              timestamp: p.timestamp,
            })),
          });
        }

        // Record lineage and flatten any prior chains pointing to old id
        await tx.$executeRaw`
          INSERT OR REPLACE INTO book_id_history (old_id, current_id, timestamp)
          VALUES (${id}, ${newId}, ${Date.now()})
        `;
        await tx.$executeRaw`
          UPDATE book_id_history SET current_id = ${newId}
          WHERE current_id = ${id}
        `;
      } else {
        await tx.book.update({
          where: { id },
          data: {
            title: meta.title.trim(),
            fileAs: (meta.fileAs || '').trim(),
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
            chapterCount: meta.chapterCount,
            chapterSpineMap: JSON.stringify(meta.chapterSpineMap),
            chapterNames: JSON.stringify(meta.chapterNames),
            pageCount: meta.pageCount,
          },
        });
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
      const rows = await this.prisma.book.findMany({
        where: {
          coverMime: { not: null },
          thumbnails: { none: { width } },
        },
        select: { id: true },
      });
      for (const { id } of rows) {
        result.push({ bookId: id, width });
      }
    }
    return result;
  }

  async scan(
    importer: ScanImporter = defaultImporter
  ): Promise<{ imported: string[]; removed: string[] }> {
    const imported: string[] = [];
    const removed: string[] = [];

    const dbIdRows = await this.prisma.book.findMany({ select: { id: true } });
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
    const allIdRows = await this.prisma.book.findMany({ select: { id: true } });
    for (const { id } of allIdRows) {
      const canonicalPath = path.join(this.booksDir, id + '.epub');
      if (!fs.existsSync(canonicalPath)) {
        await this.removeStaleBook(id);
        removed.push(id + '.epub');
      }
    }

    return { imported, removed };
  }

  private prismaBookToBook(r: Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>): Book {
    return {
      id: r.id,
      filename: downloadFilename({
        author: r.author,
        series: r.series,
        seriesIndex: r.seriesIndex,
        title: r.title,
      }),
      path: path.join(this.booksDir, r.id + '.epub'),
      title: r.title,
      fileAs: r.fileAs,
      author: r.author,
      description: r.description,
      publisher: r.publisher,
      series: r.series,
      seriesIndex: r.seriesIndex,
      identifiers: JSON.parse(r.identifiers) as { scheme: string; value: string }[],
      subjects: JSON.parse(r.subjects) as string[],
      hasCover: r.coverMime !== null,
      size: r.size,
      mtime: new Date(r.mtime),
      addedAt: new Date(r.addedAt),
      chapterCount: r.chapterCount,
      chapterSpineMap: JSON.parse(r.chapterSpineMap) as number[],
      chapterNames: r.chapterNames ? (JSON.parse(r.chapterNames) as string[]) : [],
      pageCount: r.pageCount,
    };
  }
}

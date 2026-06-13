import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { Book, BookSummary, EpubMeta, Owner, PagedBookListResponse } from '../types';
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

export class SelfLinkError extends Error {
  constructor() {
    super('Cannot link a document ID to itself');
    this.name = 'SelfLinkError';
  }
}

export class DocumentAlreadyLinkedError extends Error {
  constructor(public readonly documentId: string) {
    super(`Document "${documentId}" is already linked to a book`);
    this.name = 'DocumentAlreadyLinkedError';
  }
}

export class DocumentIsBookError extends Error {
  constructor(public readonly documentId: string) {
    super(`Document "${documentId}" is an existing book — use the book's lineage to link instead`);
    this.name = 'DocumentIsBookError';
  }
}

export interface ScanImporter {
  parseEpub: (filePath: string) => EpubMeta;
  partialMD5: (filePath: string) => string;
}

const defaultImporter: ScanImporter = { parseEpub, partialMD5 };

export class BookStore {
  constructor(
    private readonly booksRoot: string,
    private readonly prisma: PrismaClient
  ) {}

  getBooksRoot(): string {
    return this.booksRoot;
  }

  getStagingDir(): string {
    return path.join(this.booksRoot, '.staging');
  }

  getUserDir(owner: Owner): string {
    return path.join(this.booksRoot, owner.username);
  }

  private bookPath(owner: Owner, id: string): string {
    return path.join(this.getUserDir(owner), id + '.epub');
  }

  async listBooks(owner: Owner): Promise<Book[]> {
    const rows = await this.prisma.book.findMany({
      where: { userId: owner.userId },
      select: BOOK_SELECT,
    });
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
    return rows.map((r) => this.prismaBookToBook(owner, r));
  }

  async getBookById(owner: Owner, id: string): Promise<Book | null> {
    const row = await this.prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id } },
      select: BOOK_SELECT,
    });
    return row ? this.prismaBookToBook(owner, row) : null;
  }

  async addBook(owner: Owner, id: string, srcPath: string, meta: EpubMeta): Promise<void> {
    const existing = await this.prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id } },
      select: { id: true },
    });
    if (existing) {
      throw new BookAlreadyExistsError(id);
    }

    fs.mkdirSync(this.getUserDir(owner), { recursive: true });
    const targetPath = this.bookPath(owner, id);
    if (path.resolve(srcPath) !== path.resolve(targetPath)) {
      fs.renameSync(srcPath, targetPath);
    }

    const stat = fs.statSync(targetPath);
    const title = meta.title.trim();
    const fileAs = (meta.fileAs || '').trim();

    let seriesId: string | null = null;
    const seriesName = meta.series.trim();
    if (seriesName) {
      const s = await this.prisma.series.upsert({
        where: { userId_name: { userId: owner.userId, name: seriesName } },
        create: { id: randomUUID(), userId: owner.userId, name: seriesName, sortKey: seriesName },
        update: {},
        select: { id: true },
      });
      seriesId = s.id;
    }

    await this.prisma.book.create({
      data: {
        userId: owner.userId,
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
        seriesId,
      },
    });
  }

  async resolveBookId(userId: string, id: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ current_id: string }>>`
      SELECT current_id FROM book_id_history WHERE user_id = ${userId} AND old_id = ${id}
    `;
    return rows.length > 0 ? rows[0].current_id : id;
  }

  async getBookLineage(
    owner: Owner,
    id: string
  ): Promise<{
    currentId: string;
    entries: { oldId: string; newId: string; timestamp: number; type: string }[];
  } | null> {
    const book = await this.prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id } },
      select: { id: true },
    });
    if (!book) return null;

    const rows = await this.prisma.$queryRaw<
      Array<{ old_id: string; timestamp: number; type: string }>
    >`
      SELECT old_id, timestamp, type FROM book_id_history
      WHERE user_id = ${owner.userId} AND current_id = ${id}
      ORDER BY timestamp DESC, rowid DESC
    `;

    const entries = rows.map((row, i, arr) => ({
      oldId: row.old_id,
      newId: i === 0 ? id : arr[i - 1].old_id,
      timestamp: row.timestamp,
      type: row.type,
    }));

    return { currentId: id, entries };
  }

  async linkDocument(owner: Owner, bookId: string, documentId: string): Promise<true | null> {
    if (documentId === bookId) throw new SelfLinkError();

    const book = await this.prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id: bookId } },
      select: { id: true },
    });
    if (!book) return null;

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.$queryRaw<Array<{ current_id: string }>>`
        SELECT current_id FROM book_id_history
        WHERE user_id = ${owner.userId} AND old_id = ${documentId}
      `;
      if (existing.length > 0) throw new DocumentAlreadyLinkedError(documentId);

      const isBook = await tx.book.findUnique({
        where: { userId_id: { userId: owner.userId, id: documentId } },
        select: { id: true },
      });
      if (isBook) throw new DocumentIsBookError(documentId);

      // Lineage is per-user, so only the owner's progress rows migrate.
      const orphanProgress = await tx.progress.findUnique({
        where: { userId_document: { userId: owner.userId, document: documentId } },
      });
      if (orphanProgress) {
        const targetProgress = await tx.progress.findUnique({
          where: { userId_document: { userId: owner.userId, document: bookId } },
        });
        if (!targetProgress || orphanProgress.timestamp >= targetProgress.timestamp) {
          if (targetProgress) {
            await tx.progress.delete({
              where: { userId_document: { userId: owner.userId, document: bookId } },
            });
          }
          await tx.progress.delete({
            where: { userId_document: { userId: owner.userId, document: documentId } },
          });
          await tx.progress.create({ data: { ...orphanProgress, document: bookId } });
        } else {
          await tx.progress.delete({
            where: { userId_document: { userId: owner.userId, document: documentId } },
          });
        }
      }

      await tx.$executeRaw`
        INSERT INTO book_id_history (user_id, old_id, current_id, timestamp, type)
        VALUES (${owner.userId}, ${documentId}, ${bookId}, ${Date.now()}, 'merge')
      `;
    });

    return true;
  }

  async unlinkDocument(
    owner: Owner,
    bookId: string,
    documentId: string
  ): Promise<'deleted' | 'not_found' | 'edit_row'> {
    return await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ type: string }>>`
        SELECT type FROM book_id_history
        WHERE user_id = ${owner.userId} AND old_id = ${documentId} AND current_id = ${bookId}
      `;
      if (rows.length === 0) return 'not_found';
      if (rows[0].type === 'edit') return 'edit_row';

      // By design, unlinking does not reverse the progress migration.
      // Progress that was migrated from documentId to bookId during linkDocument stays on bookId.
      await tx.$executeRaw`
        DELETE FROM book_id_history
        WHERE user_id = ${owner.userId} AND old_id = ${documentId} AND current_id = ${bookId}
      `;
      return 'deleted';
    });
  }

  async deleteBook(owner: Owner, id: string): Promise<Book | null> {
    const book = await this.getBookById(owner, id);
    if (!book) return null;
    try {
      await this.prisma.$transaction(async (tx) => {
        // Capture seriesId before deleting the row
        const bookRow = await tx.book.findUnique({
          where: { userId_id: { userId: owner.userId, id } },
          select: { seriesId: true },
        });
        const seriesId = bookRow?.seriesId ?? null;

        try {
          await tx.book.delete({ where: { userId_id: { userId: owner.userId, id } } });
        } catch (err) {
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'))
            throw err;
        }
        await tx.$executeRaw`
          DELETE FROM book_id_history
          WHERE user_id = ${owner.userId} AND (old_id = ${id} OR current_id = ${id})
        `;

        if (seriesId) {
          const remaining = await tx.book.count({ where: { seriesId } });
          if (remaining === 0) {
            await tx.series.delete({ where: { id: seriesId } });
          }
        }
      });
    } finally {
      try {
        fs.unlinkSync(book.path);
      } catch {
        /* file already gone */
      }
    }
    return book;
  }

  async reimportBook(
    owner: Owner,
    id: string,
    importer: ScanImporter = defaultImporter
  ): Promise<Book | null> {
    const exists = await this.prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id } },
      select: { id: true, series: true, seriesId: true },
    });
    if (!exists) return null;
    const oldSeriesId = exists.seriesId;

    const filePath = this.bookPath(owner, id);
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
        where: { userId_id: { userId: owner.userId, id: newId } },
        select: { id: true },
      });
      if (collision) {
        throw new BookHashCollisionError(newId);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Resolve new seriesId
      let newSeriesId: string | null = null;
      const newSeriesName = meta.series.trim();
      if (newSeriesName) {
        const s = await tx.series.upsert({
          where: { userId_name: { userId: owner.userId, name: newSeriesName } },
          create: {
            id: randomUUID(),
            userId: owner.userId,
            name: newSeriesName,
            sortKey: newSeriesName,
          },
          update: {},
          select: { id: true },
        });
        newSeriesId = s.id;
      }

      if (newId !== id) {
        const oldPath = this.bookPath(owner, id);
        const newPath = this.bookPath(owner, newId);
        if (oldPath !== newPath) {
          fs.renameSync(oldPath, newPath);
        }

        // Update the book row (and cascade-update thumbnails via the FK onUpdate: Cascade).
        await tx.book.update({
          where: { userId_id: { userId: owner.userId, id } },
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
            seriesId: newSeriesId,
          },
        });

        // Progress has no FK to books and lineage is per-user, so migrate only
        // the owner's progress rows.
        const oldProgress = await tx.progress.findUnique({
          where: { userId_document: { userId: owner.userId, document: id } },
        });
        if (oldProgress) {
          const newProgress = await tx.progress.findUnique({
            where: { userId_document: { userId: owner.userId, document: newId } },
          });
          if (!newProgress || oldProgress.timestamp >= newProgress.timestamp) {
            if (newProgress) {
              await tx.progress.delete({
                where: { userId_document: { userId: owner.userId, document: newId } },
              });
            }
            await tx.progress.delete({
              where: { userId_document: { userId: owner.userId, document: id } },
            });
            await tx.progress.create({ data: { ...oldProgress, document: newId } });
          } else {
            await tx.progress.delete({
              where: { userId_document: { userId: owner.userId, document: id } },
            });
          }
        }

        // Record lineage and flatten any prior chains pointing to old id
        await tx.$executeRaw`
          INSERT OR REPLACE INTO book_id_history (user_id, old_id, current_id, timestamp)
          VALUES (${owner.userId}, ${id}, ${newId}, ${Date.now()})
        `;
        await tx.$executeRaw`
          UPDATE book_id_history SET current_id = ${newId}
          WHERE user_id = ${owner.userId} AND current_id = ${id}
        `;
      } else {
        await tx.book.update({
          where: { userId_id: { userId: owner.userId, id } },
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
            seriesId: newSeriesId,
          },
        });
      }

      // Clean up the old Series row if it now has no books
      if (oldSeriesId && oldSeriesId !== newSeriesId) {
        const remaining = await tx.book.count({ where: { seriesId: oldSeriesId } });
        if (remaining === 0) {
          await tx.series.delete({ where: { id: oldSeriesId } });
        }
      }
    });

    return this.getBookById(owner, newId);
  }

  private async removeStaleBook(userId: string, id: string): Promise<void> {
    try {
      await this.prisma.book.delete({ where: { userId_id: { userId, id } } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025')) throw err;
    }
  }

  async getCover(userId: string, id: string): Promise<{ data: Buffer; mime: string } | null> {
    const row = await this.prisma.book.findUnique({
      where: { userId_id: { userId, id } },
      select: { coverData: true, coverMime: true },
    });
    if (!row || !row.coverData) return null;
    // Prisma returns BLOB columns as Uint8Array; Buffer.from() ensures Express sends binary
    return { data: Buffer.from(row.coverData), mime: row.coverMime as string };
  }

  async saveThumbnail(
    userId: string,
    bookId: string,
    width: number,
    data: Buffer,
    mime: string
  ): Promise<void> {
    await this.prisma.bookThumbnail.upsert({
      where: { userId_bookId_width: { userId, bookId, width } },
      update: { data: data as unknown as Prisma.Bytes, mime },
      create: { userId, bookId, width, data: data as unknown as Prisma.Bytes, mime },
    });
  }

  async getThumbnail(
    userId: string,
    bookId: string,
    width: number
  ): Promise<{ data: Buffer; mime: string } | null> {
    const row = await this.prisma.bookThumbnail.findUnique({
      where: { userId_bookId_width: { userId, bookId, width } },
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
  ): Promise<Array<{ userId: string; bookId: string; width: number }>> {
    const result: Array<{ userId: string; bookId: string; width: number }> = [];
    for (const width of widths) {
      const rows = await this.prisma.book.findMany({
        where: {
          coverMime: { not: null },
          thumbnails: { none: { width } },
        },
        select: { userId: true, id: true },
      });
      for (const { userId, id } of rows) {
        result.push({ userId, bookId: id, width });
      }
    }
    return result;
  }

  async scan(
    owner: Owner,
    importer: ScanImporter = defaultImporter
  ): Promise<{ imported: string[]; removed: string[] }> {
    const imported: string[] = [];
    const removed: string[] = [];
    const userDir = this.getUserDir(owner);

    const dbIdRows = await this.prisma.book.findMany({
      where: { userId: owner.userId },
      select: { id: true },
    });
    const dbIds = new Set(dbIdRows.map((r) => r.id));

    const diskFilenames: string[] = fs.existsSync(userDir)
      ? fs.readdirSync(userDir).filter((f) => path.extname(f).toLowerCase() === '.epub')
      : [];

    for (const filename of diskFilenames) {
      const filePath = path.join(userDir, filename);
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

      const canonicalPath = this.bookPath(owner, id);
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
        await this.addBook(owner, id, canonicalPath, { ...meta, title: titleFallback });
        dbIds.add(id);
        imported.push(filename);
      } catch (err: unknown) {
        log.warn(
          `scan: skipping "${filename}" — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Stale rows: in DB but their canonical file is missing.
    const allIdRows = await this.prisma.book.findMany({
      where: { userId: owner.userId },
      select: { id: true },
    });
    for (const { id } of allIdRows) {
      if (!fs.existsSync(this.bookPath(owner, id))) {
        await this.removeStaleBook(owner.userId, id);
        removed.push(id + '.epub');
      }
    }

    return { imported, removed };
  }

  private toBookSummary(book: Book): BookSummary {
    const {
      path: _path,
      description: _description,
      identifiers: _identifiers,
      subjects: _subjects,
      addedAt: _addedAt,
      chapterSpineMap: _chapterSpineMap,
      chapterNames: _chapterNames,
      ...rest
    } = book;
    return rest;
  }

  async listBooksPage(owner: Owner, after: string, take: number): Promise<PagedBookListResponse> {
    // Fetch take+1 from each source so we can detect whether another page exists
    const fetchLimit = take + 1;
    const [seriesRows, standaloneRows] = await Promise.all([
      this.prisma.series.findMany({
        where: { userId: owner.userId, sortKey: { gt: after } },
        orderBy: { sortKey: 'asc' },
        take: fetchLimit,
      }),
      this.prisma.book.findMany({
        where: { userId: owner.userId, seriesId: null, title: { gt: after } },
        orderBy: { title: 'asc' },
        take: fetchLimit,
        select: BOOK_SELECT,
      }),
    ]);

    // Merge-sort up to take+1 display units to detect overflow
    const merged: Array<
      | { sortKey: string; type: 'series'; row: (typeof seriesRows)[0] }
      | { sortKey: string; type: 'standalone'; row: (typeof standaloneRows)[0] }
    > = [];
    let si = 0;
    let bi = 0;
    while (merged.length < fetchLimit) {
      const s = seriesRows[si];
      const b = standaloneRows[bi];
      if (!s && !b) break;
      let pickSeries: boolean;
      if (!s) pickSeries = false;
      else if (!b) pickSeries = true;
      else pickSeries = s.sortKey.localeCompare(b.title) <= 0;
      if (pickSeries) {
        merged.push({ sortKey: s.sortKey, type: 'series', row: s });
        si++;
      } else {
        merged.push({ sortKey: b.title, type: 'standalone', row: b });
        bi++;
      }
    }

    const hasMore = merged.length > take;
    const page = hasMore ? merged.slice(0, take) : merged;

    // Fetch all member books for every series item
    const seriesBooksMap = new Map<string, Book[]>();
    await Promise.all(
      page
        .filter((p) => p.type === 'series')
        .map(async (p) => {
          const s = (p as { type: 'series'; row: (typeof seriesRows)[0] }).row;
          const rows = await this.prisma.book.findMany({
            where: { seriesId: s.id },
            orderBy: { seriesIndex: 'asc' },
            select: BOOK_SELECT,
          });
          seriesBooksMap.set(
            s.name,
            rows.map((r) => this.prismaBookToBook(owner, r))
          );
        })
    );

    const items: PagedBookListResponse['items'] = page.map((p) =>
      p.type === 'series'
        ? { type: 'series' as const, seriesName: (p.row as (typeof seriesRows)[0]).name }
        : { type: 'standalone' as const, bookId: (p.row as (typeof standaloneRows)[0]).id }
    );

    const books: BookSummary[] = page.flatMap((p) => {
      if (p.type === 'standalone') {
        return [
          this.toBookSummary(this.prismaBookToBook(owner, p.row as (typeof standaloneRows)[0])),
        ];
      }
      return (seriesBooksMap.get((p.row as (typeof seriesRows)[0]).name) ?? []).map((b) =>
        this.toBookSummary(b)
      );
    });

    const nextCursor = hasMore
      ? Buffer.from(page[page.length - 1].sortKey).toString('base64')
      : null;

    return { items, books, nextCursor };
  }

  private prismaBookToBook(
    owner: Owner,
    r: Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>
  ): Book {
    return {
      id: r.id,
      filename: downloadFilename({
        author: r.author,
        series: r.series,
        seriesIndex: r.seriesIndex,
        title: r.title,
      }),
      path: this.bookPath(owner, r.id),
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

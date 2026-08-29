import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { PrismaClient, Prisma, Series } from '@prisma/client';

import { logger } from '../logger';
import {
  Book,
  BookSummary,
  EpubMeta,
  Owner,
  PageCursor,
  PagedBookListResponse,
  BookListFilters,
  SearchSuggestionsResponse,
} from '../types';
import {
  normalizeForSearch,
  toSubsequenceLike,
  computeMatchWindow,
  scoreAndRank,
} from '../utils/fuzzy-search';
import { seriesSortKey } from '../utils/series-sort-key';
import { BOOK_SELECT, getBookById, prismaBookToBook, standaloneStatusWhere } from './book-catalog';
import { BookAlreadyExistsError, BookHashCollisionError } from './book-errors';
import { bookPath, getStagingDir, getUserDir } from './book-paths';
import { purgeForBook } from './edition';
import { parseEpub, partialMD5 } from './epub-parser';
import type { ScanProgress } from './scan-events';

const log = logger('BookStore');

/** Compares two cover blobs (or their absence) for equality. */
function buffersEqual(a: Buffer | Uint8Array | null, b: Buffer | Uint8Array | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Buffer.from(a).equals(Buffer.from(b));
}

export interface ScanImporter {
  parseEpub: (filePath: string) => EpubMeta;
  partialMD5: (filePath: string) => string;
}

const defaultImporter: ScanImporter = { parseEpub, partialMD5 };

export class BookStore {
  constructor(
    private readonly booksRoot: string,
    private readonly prisma: PrismaClient,
    private readonly editionsRoot: string
  ) {}

  getStagingDir(): string {
    return getStagingDir(this.booksRoot);
  }

  async getSearchSuggestions(
    owner: Owner,
    {
      q,
      filter,
    }: {
      q: string;
      filter: { author?: string; seriesName?: string; activeSubjects?: string[] };
    }
  ): Promise<SearchSuggestionsResponse> {
    const normalizedQ = normalizeForSearch(q);
    if (!normalizedQ) return { groups: [] };
    const likePat = toSubsequenceLike(normalizedQ);
    const groups: SearchSuggestionsResponse['groups'] = [];

    if (!filter.author) {
      const rows = await this.prisma.$queryRaw<Array<{ value: string }>>`
        SELECT DISTINCT author AS value
        FROM books
        WHERE user_id = ${owner.userId}
          AND author LIKE ${likePat}
          ${filter.seriesName ? Prisma.sql`AND series = ${filter.seriesName}` : Prisma.empty}
        ORDER BY author
        LIMIT 30
      `;
      const ranked = scoreAndRank(
        rows.map((r) => ({ label: r.value, value: r.value })),
        normalizedQ
      );
      if (ranked.length > 0)
        groups.push({
          type: 'author',
          items: ranked.map(({ label, value }) => ({
            label,
            value,
            ...computeMatchWindow(q, label),
          })),
        });
    }

    if (!filter.seriesName) {
      const rows = await this.prisma.$queryRaw<Array<{ value: string }>>`
        SELECT s.name AS value
        FROM series s
        WHERE s.user_id = ${owner.userId}
          AND s.name LIKE ${likePat}
          ${
            filter.author
              ? Prisma.sql`AND EXISTS (
                  SELECT 1 FROM books b
                  WHERE b.series_id = s.id AND b.author = ${filter.author}
                )`
              : Prisma.empty
          }
        ORDER BY s.name
        LIMIT 30
      `;
      const ranked = scoreAndRank(
        rows.map((r) => ({ label: r.value, value: r.value })),
        normalizedQ
      );
      if (ranked.length > 0)
        groups.push({
          type: 'series',
          items: ranked.map(({ label, value }) => ({
            label,
            value,
            ...computeMatchWindow(q, label),
          })),
        });
    }

    const [bookRows, subjectRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string; title: string }>>`
        SELECT id, title
        FROM books
        WHERE user_id = ${owner.userId}
          AND title LIKE ${likePat}
          ${filter.author ? Prisma.sql`AND author = ${filter.author}` : Prisma.empty}
          ${filter.seriesName ? Prisma.sql`AND series = ${filter.seriesName}` : Prisma.empty}
        ORDER BY title
        LIMIT 30
      `,
      this.prisma.$queryRaw<Array<{ value: string }>>`
        SELECT DISTINCT trim(CAST(json_each.value AS TEXT)) AS value
        FROM books, json_each(books.subjects)
        WHERE user_id = ${owner.userId}
          AND LOWER(trim(CAST(json_each.value AS TEXT))) LIKE LOWER(${likePat})
          ${filter.author ? Prisma.sql`AND author = ${filter.author}` : Prisma.empty}
          ${filter.seriesName ? Prisma.sql`AND series = ${filter.seriesName}` : Prisma.empty}
          AND json_each.type = 'text'
          AND trim(CAST(json_each.value AS TEXT)) <> ''
        ORDER BY value
        LIMIT 30
      `,
    ]);

    const rankedBooks = scoreAndRank(
      bookRows.map((r) => ({ label: r.title, value: r.id })),
      normalizedQ
    );
    if (rankedBooks.length > 0)
      groups.push({
        type: 'book',
        items: rankedBooks.map(({ label, value }) => ({
          label,
          value,
          ...computeMatchWindow(q, label),
        })),
      });

    const activeSubjectSet = new Set(filter.activeSubjects ?? []);
    const rankedSubjects = scoreAndRank(
      subjectRows
        .filter((r) => !activeSubjectSet.has(r.value))
        .map((r) => ({ label: r.value, value: r.value })),
      normalizedQ
    );
    if (rankedSubjects.length > 0)
      groups.push({
        type: 'subject',
        items: rankedSubjects.map(({ label, value }) => ({
          label,
          value,
          ...computeMatchWindow(q, label),
        })),
      });

    return { groups };
  }

  async addBook(owner: Owner, id: string, srcPath: string, meta: EpubMeta): Promise<void> {
    const existing = await this.prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id } },
      select: { id: true },
    });
    if (existing) {
      throw new BookAlreadyExistsError(id);
    }

    fs.mkdirSync(getUserDir(this.booksRoot, owner), { recursive: true });
    const targetPath = bookPath(this.booksRoot, owner, id);
    if (path.resolve(srcPath) !== path.resolve(targetPath)) {
      fs.renameSync(srcPath, targetPath);
    }

    const stat = fs.statSync(targetPath);
    const title = meta.title.trim();
    const titleSort = (meta.titleSort || '').trim();
    const authorSort = (meta.authorSort || '').trim();
    const publishDate = (meta.publishDate || '').trim();
    const author = (meta.author || '').trim();

    await this.prisma.$transaction(async (tx) => {
      let seriesId: string | null = null;
      const seriesName = meta.series.trim();
      if (seriesName) {
        const s = await tx.series.upsert({
          where: { userId_name: { userId: owner.userId, name: seriesName } },
          create: {
            id: randomUUID(),
            userId: owner.userId,
            name: seriesName,
            sortKey: seriesSortKey(seriesName),
          },
          update: {},
          select: { id: true },
        });
        seriesId = s.id;
      }

      await tx.book.create({
        data: {
          userId: owner.userId,
          id,
          title,
          titleSort,
          authorSort,
          publishDate,
          author,
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

      if (seriesId) {
        await this.recomputeSeriesMeta(tx, seriesId);
      }
    });
  }

  async deleteBook(owner: Owner, id: string): Promise<Book | null> {
    const book = await getBookById(this.prisma, this.booksRoot, owner, id);
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
          } else {
            await this.recomputeSeriesMeta(tx, seriesId);
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
    try {
      await purgeForBook(this.prisma, this.editionsRoot, owner.userId, id);
    } catch (err) {
      log.warn(
        `deleteBook: edition-cache purge failed for "${id}" — ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return book;
  }

  /**
   * Deletes all cached device editions (DB rows + on-disk files) for a book
   * across every device. Returns the number cleared, or null when the book
   * does not exist. A rare recovery action for when a book's editions get into
   * a bad state; editions regenerate lazily on the next device download.
   */
  async clearDeviceEditions(owner: Owner, id: string): Promise<number | null> {
    const book = await getBookById(this.prisma, this.booksRoot, owner, id, {
      withEditionCount: true,
    });
    if (!book) return null;
    const cleared = book.deviceEditionCount ?? 0;
    await purgeForBook(this.prisma, this.editionsRoot, owner.userId, id);
    return cleared;
  }

  async reimportBook(
    owner: Owner,
    id: string,
    importer: ScanImporter = defaultImporter
  ): Promise<Book | null> {
    const exists = await this.prisma.book.findUnique({
      where: { userId_id: { userId: owner.userId, id } },
      select: { id: true, series: true, seriesId: true, coverData: true },
    });
    if (!exists) return null;
    const oldSeriesId = exists.seriesId;

    const filePath = bookPath(this.booksRoot, owner, id);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return null;
    }
    const meta = importer.parseEpub(filePath);
    const newId = importer.partialMD5(filePath);

    // Cached per-width thumbnails are derived from the cover; if the cover changed we must
    // drop them so a stale thumbnail is never served — especially under the new immutable
    // cache URL, where it would otherwise be cached indefinitely. Regeneration happens via
    // the caller's thumbnail enqueue / reconcile.
    const coverChanged = !buffersEqual(exists.coverData, meta.coverData);

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
      const author = (meta.author || '').trim();
      if (newSeriesName) {
        const s = await tx.series.upsert({
          where: { userId_name: { userId: owner.userId, name: newSeriesName } },
          create: {
            id: randomUUID(),
            userId: owner.userId,
            name: newSeriesName,
            sortKey: seriesSortKey(newSeriesName),
          },
          update: {},
          select: { id: true },
        });
        newSeriesId = s.id;
      }

      if (newId !== id) {
        const oldPath = bookPath(this.booksRoot, owner, id);
        const newPath = bookPath(this.booksRoot, owner, newId);
        if (oldPath !== newPath) {
          fs.renameSync(oldPath, newPath);
        }

        // Update the book row (and cascade-update thumbnails via the FK onUpdate: Cascade).
        await tx.book.update({
          where: { userId_id: { userId: owner.userId, id } },
          data: {
            id: newId,
            title: meta.title.trim(),
            titleSort: (meta.titleSort || '').trim(),
            authorSort: (meta.authorSort || '').trim(),
            publishDate: (meta.publishDate || '').trim(),
            author,
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
            titleSort: (meta.titleSort || '').trim(),
            authorSort: (meta.authorSort || '').trim(),
            publishDate: (meta.publishDate || '').trim(),
            author,
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

      // Invalidate stale thumbnails when the cover changed. In the id-change branch the
      // FK onUpdate: Cascade has already moved the rows to newId, so keying on newId
      // covers both branches.
      if (coverChanged) {
        await tx.bookThumbnail.deleteMany({
          where: { userId: owner.userId, bookId: newId },
        });
      }

      // Clean up the old Series row if it now has no books; recompute if it still has some
      if (oldSeriesId && oldSeriesId !== newSeriesId) {
        const remaining = await tx.book.count({ where: { seriesId: oldSeriesId } });
        if (remaining === 0) {
          await tx.series.delete({ where: { id: oldSeriesId } });
        } else {
          await this.recomputeSeriesMeta(tx, oldSeriesId);
        }
      }

      // Recompute the new series aggregates
      if (newSeriesId) {
        await this.recomputeSeriesMeta(tx, newSeriesId);
      }
    });

    try {
      await purgeForBook(this.prisma, this.editionsRoot, owner.userId, id);
      if (newId !== id) await purgeForBook(this.prisma, this.editionsRoot, owner.userId, newId);
    } catch (err) {
      log.warn(
        `reimportBook: edition-cache purge failed for "${id}" — ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return getBookById(this.prisma, this.booksRoot, owner, newId);
  }

  private async removeStaleBook(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const book = await tx.book.findUnique({
        where: { userId_id: { userId, id } },
        select: { seriesId: true },
      });
      if (!book) return;

      await tx.book.delete({ where: { userId_id: { userId, id } } });

      if (book.seriesId) {
        const remaining = await tx.book.count({ where: { seriesId: book.seriesId } });
        if (remaining === 0) {
          await tx.series.delete({ where: { id: book.seriesId } });
        } else {
          await this.recomputeSeriesMeta(tx, book.seriesId);
        }
      }
    });
  }

  async getSeriesNextIndex(owner: Owner, name: string): Promise<number> {
    const result = await this.prisma.book.aggregate({
      where: { userId: owner.userId, series: name },
      _max: { seriesIndex: true },
    });
    const max = result._max.seriesIndex;
    return max == null ? 1 : Math.floor(max) + 1;
  }

  async scan(
    owner: Owner,
    importer: ScanImporter = defaultImporter,
    onProgress?: (progress: ScanProgress) => void
  ): Promise<{ imported: string[]; removed: string[] }> {
    const imported: string[] = [];
    const removed: string[] = [];
    const userDir = getUserDir(this.booksRoot, owner);

    const dbIdRows = await this.prisma.book.findMany({
      where: { userId: owner.userId },
      select: { id: true },
    });
    const dbIds = new Set(dbIdRows.map((r) => r.id));

    const diskFilenames: string[] = fs.existsSync(userDir)
      ? fs.readdirSync(userDir).filter((f) => path.extname(f).toLowerCase() === '.epub')
      : [];
    const totalImporting = diskFilenames.length;

    for (const [index, filename] of diskFilenames.entries()) {
      const processed = index + 1;
      // Reports the one outcome the branch below is about to take for this
      // file, at the exact point the loop already decides it — no branch is
      // added or reordered to make this possible. `bookId` is included only
      // when the branch has one in hand (`undefined` is dropped, never sent
      // as an explicit `bookId: undefined`).
      const emit = (
        outcome: 'imported' | 'renamed' | 'already-imported' | 'skipped',
        bookId?: string
      ): void => {
        onProgress?.({
          phase: 'importing',
          total: totalImporting,
          processed,
          filename,
          outcome,
          ...(bookId !== undefined ? { bookId } : {}),
        });
      };

      const filePath = path.join(userDir, filename);
      const stem = path.basename(filename, '.epub');

      // Fast path: file already at <id>.epub and that id is imported.
      if (/^[0-9a-f]{32}$/.test(stem) && dbIds.has(stem)) {
        emit('already-imported', stem);
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
        emit('skipped');
        continue;
      }

      const canonicalPath = bookPath(this.booksRoot, owner, id);
      if (filePath !== canonicalPath) {
        if (fs.existsSync(canonicalPath)) {
          log.warn(`scan: skipping "${filename}" — canonical path ${id}.epub already occupied`);
          emit('skipped', id);
          continue;
        }
        fs.renameSync(filePath, canonicalPath);
      }

      if (dbIds.has(id)) {
        // Rename above was the only thing to do.
        emit('renamed', id);
        continue;
      }

      try {
        const titleFallback = meta.title.trim() || path.basename(filename, path.extname(filename));
        await this.addBook(owner, id, canonicalPath, { ...meta, title: titleFallback });
        dbIds.add(id);
        imported.push(filename);
        emit('imported', id);
      } catch (err: unknown) {
        log.warn(
          `scan: skipping "${filename}" — ${err instanceof Error ? err.message : String(err)}`
        );
        emit('skipped', id);
      }
    }

    // Stale rows: in DB but their canonical file is missing.
    const allIdRows = await this.prisma.book.findMany({
      where: { userId: owner.userId },
      select: { id: true },
    });
    const totalPruning = allIdRows.length;
    for (const [index, { id }] of allIdRows.entries()) {
      if (!fs.existsSync(bookPath(this.booksRoot, owner, id))) {
        await this.removeStaleBook(owner.userId, id);
        removed.push(id + '.epub');
      }
      onProgress?.({ phase: 'pruning', total: totalPruning, processed: index + 1, bookId: id });
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

  private async seriesIdsForStatus(
    userId: string,
    status: 'not-started' | 'in-progress' | 'completed'
  ): Promise<string[]> {
    // Compute series status via a single GROUP BY + HAVING aggregate query.
    // LEFT JOIN books so empty series count as not-started (COUNT(b.id) = 0).
    // LEFT JOIN progress on (document, user_id) so unread books have NULL percentage.
    if (status === 'not-started') {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT s.id
        FROM series s
        LEFT JOIN books b ON b.series_id = s.id
        LEFT JOIN progress p ON p.document = b.id AND p.user_id = ${userId}
        WHERE s.user_id = ${userId}
        GROUP BY s.id
        HAVING COALESCE(SUM(CASE WHEN p.percentage > 0 THEN 1 ELSE 0 END), 0) = 0
      `;
      return rows.map((r) => r.id);
    }
    if (status === 'in-progress') {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT s.id
        FROM series s
        LEFT JOIN books b ON b.series_id = s.id
        LEFT JOIN progress p ON p.document = b.id AND p.user_id = ${userId}
        WHERE s.user_id = ${userId}
        GROUP BY s.id
        HAVING SUM(CASE WHEN p.percentage > 0 AND p.percentage < 1 THEN 1 ELSE 0 END) > 0
      `;
      return rows.map((r) => r.id);
    }
    // completed: series is non-empty and every member book has percentage >= 1
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT s.id
      FROM series s
      LEFT JOIN books b ON b.series_id = s.id
      LEFT JOIN progress p ON p.document = b.id AND p.user_id = ${userId}
      WHERE s.user_id = ${userId}
      GROUP BY s.id
      HAVING
        COUNT(b.id) > 0
        AND COUNT(b.id) = SUM(CASE WHEN p.percentage >= 1 THEN 1 ELSE 0 END)
    `;
    return rows.map((r) => r.id);
  }

  async listBooksPage(
    owner: Owner,
    cursor: PageCursor | null,
    take: number,
    filters?: BookListFilters
  ): Promise<PagedBookListResponse> {
    // Fetch take+1 from each source so we can detect whether another page exists
    const fetchLimit = take + 1;

    const includeStandalones = filters?.seriesName === undefined && filters?.entryType !== 'series';
    const includeSeries = filters?.entryType !== 'standalone';

    // Pre-fetch progress only when status filter applies to standalone books.
    // Series status is computed at the DB level by seriesIdsForStatus().
    let progressMap: Map<string, number> | null = null;
    if (filters?.status && includeStandalones) {
      const progresses = await this.prisma.progress.findMany({
        where: { userId: owner.userId },
        select: { document: true, percentage: true },
      });
      progressMap = new Map(progresses.map((p) => [p.document, p.percentage]));
    }

    // Build where conditions that resume cleanly after the cursor.
    // Series names are unique per user so their sort key alone is sufficient.
    // Standalones need a compound (title, id) tiebreaker because two books can
    // share a title; `id` is the stable secondary key.
    // When the last page ended on a series at sort key K, standalones at exactly
    // K still need to be shown (series sorts before same-key standalone).
    let seriesWhere: Prisma.SeriesWhereInput = cursor
      ? { userId: owner.userId, sortKey: { gt: cursor.k } }
      : { userId: owner.userId };

    // When a title query is active without a specific series filter, include series
    // member books so that e.g. searching "gate" also returns "Abaddon's Gate" as a
    // book row alongside the "The Expanse" series row.
    const queryExpandsToSeriesBooks =
      !!filters?.query && filters?.seriesName === undefined && filters?.entryType !== 'standalone';

    let bookWhere: Prisma.BookWhereInput;
    if (!cursor) {
      bookWhere = queryExpandsToSeriesBooks
        ? { userId: owner.userId }
        : { userId: owner.userId, seriesId: null };
    } else if (cursor.t === 's') {
      // Last item was a series at K; standalones at K come next
      bookWhere = queryExpandsToSeriesBooks
        ? { userId: owner.userId, title: { gte: cursor.k } }
        : { userId: owner.userId, seriesId: null, title: { gte: cursor.k } };
    } else {
      // Last item was a standalone at (K, id); resume with compound filter
      bookWhere = {
        userId: owner.userId,
        ...(queryExpandsToSeriesBooks ? {} : { seriesId: null }),
        OR: [{ title: { gt: cursor.k } }, { title: { equals: cursor.k }, id: { gt: cursor.id } }],
      };
    }

    // Apply status filter to standalone WHERE
    if (includeStandalones && filters?.status && progressMap) {
      const statusFilter = standaloneStatusWhere(filters.status, progressMap);
      bookWhere = { ...bookWhere, ...statusFilter };
    }

    // Apply subjects filter — subjects are stored as JSON arrays so we match the
    // quoted element value (e.g. '"Fantasy"') to avoid substring false-positives.
    // Multiple subjects are ANDed together (book/series must have ALL of them).
    if (filters?.subjects?.length) {
      const subjectClauses = filters.subjects.map((subject) => ({
        subjects: { contains: JSON.stringify(subject) },
      }));
      if (includeStandalones) {
        bookWhere = { ...bookWhere, AND: subjectClauses };
      }
      seriesWhere = { ...seriesWhere, AND: subjectClauses };
    }

    // query: case-insensitive contains on book title and series name/member titles.
    // Title is composed via AND to avoid overwriting the pagination cursor predicate
    // (title: { gte: cursor.k }) that may already be set on bookWhere.
    if (filters?.query) {
      if (includeStandalones) {
        const existingAnd = bookWhere.AND;
        bookWhere = {
          ...bookWhere,
          AND: [
            ...(Array.isArray(existingAnd) ? existingAnd : existingAnd ? [existingAnd] : []),
            { title: { contains: filters.query } },
          ],
        };
      }
      seriesWhere = {
        ...seriesWhere,
        OR: [
          { name: { contains: filters.query } },
          { books: { some: { title: { contains: filters.query } } } },
        ],
      };
    }

    // author: case-insensitive contains on book author; series has own author field
    if (filters?.author) {
      if (includeStandalones) {
        bookWhere = { ...bookWhere, author: { contains: filters.author } };
      }
      seriesWhere = { ...seriesWhere, author: { contains: filters.author } };
    }

    // seriesName: exact match — only the named series, no standalones
    if (filters?.seriesName) {
      seriesWhere = { ...seriesWhere, name: { equals: filters.seriesName } };
    }

    // For series status filter, compute matching series IDs at the DB level
    let matchingSeriesIds: string[] | null = null;
    if (includeSeries && filters?.status) {
      matchingSeriesIds = await this.seriesIdsForStatus(owner.userId, filters.status);
    }

    const finalSeriesWhere: Prisma.SeriesWhereInput =
      matchingSeriesIds !== null ? { ...seriesWhere, id: { in: matchingSeriesIds } } : seriesWhere;

    // Note: standalone books are sorted by `title`, not `fileAs || title`. This matches the
    // ordering the old client-side UI used (useBookList sorts by title). The OPDS path
    // (listBooks) sorts by fileAs || title, so the two orderings intentionally differ.
    const [seriesRows, standaloneRows] = await Promise.all([
      includeSeries
        ? this.prisma.series.findMany({
            where: finalSeriesWhere,
            orderBy: { sortKey: 'asc' },
            take: fetchLimit,
          })
        : Promise.resolve([] as Series[]),
      includeStandalones
        ? this.prisma.book.findMany({
            where: bookWhere,
            orderBy: [{ title: 'asc' }, { id: 'asc' }],
            take: fetchLimit,
            select: BOOK_SELECT,
          })
        : Promise.resolve([] as Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>[]),
    ]);

    // Merge-sort up to take+1 display units to detect overflow.
    // Use binary string comparison (< and <=) to match SQLite's binary collation used
    // in the WHERE/ORDER BY clauses above. Using localeCompare here would disagree with
    // the DB ordering on case and accented characters, causing wrong picks at page
    // boundaries.
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
      else pickSeries = s.sortKey <= b.title;
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
            rows.map((r) => prismaBookToBook(this.booksRoot, owner, r))
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
          this.toBookSummary(
            prismaBookToBook(this.booksRoot, owner, p.row as (typeof standaloneRows)[0])
          ),
        ];
      }
      return (seriesBooksMap.get((p.row as (typeof seriesRows)[0]).name) ?? []).map((b) =>
        this.toBookSummary(b)
      );
    });

    const last = page[page.length - 1];
    const nextCursor = hasMore
      ? Buffer.from(
          JSON.stringify({
            k: last.sortKey,
            t: last.type === 'series' ? 's' : 'b',
            id: last.row.id,
          })
        ).toString('base64')
      : null;

    return { items, books, nextCursor };
  }

  private async recomputeSeriesMeta(
    client: Pick<PrismaClient, 'book' | 'series'>,
    seriesId: string
  ): Promise<void> {
    const books = await client.book.findMany({
      where: { seriesId },
      select: { subjects: true, author: true, publisher: true, pageCount: true, size: true },
      orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
    });

    const bookCount = books.length;
    const totalPages = books.reduce((sum, b) => sum + b.pageCount, 0);
    const totalSize = books.reduce((sum, b) => sum + b.size, 0);

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
    const subjects = [...seenSubjects.values()].sort((a, b) => a.localeCompare(b));

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

    await client.series.update({
      where: { id: seriesId },
      data: {
        subjects: JSON.stringify(subjects),
        bookCount,
        author,
        publisher,
        totalPages,
        totalSize,
      },
    });
  }
}

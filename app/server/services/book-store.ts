import { PrismaClient, Prisma, Series } from '@prisma/client';

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
import { BOOK_SELECT, prismaBookToBook, standaloneStatusWhere } from './book-catalog';
import {
  addBook as addBookImpl,
  clearDeviceEditions as clearDeviceEditionsImpl,
  deleteBook as deleteBookImpl,
  reimportBook as reimportBookImpl,
  scan as scanImpl,
} from './book-lifecycle';
import { getStagingDir } from './book-paths';
import type { ScanProgress } from './scan-events';
import { getSearchSuggestions } from './search-suggestions';
import { getSeriesNextIndex } from './series-meta';

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
    args: {
      q: string;
      filter: { author?: string; seriesName?: string; activeSubjects?: string[] };
    }
  ): Promise<SearchSuggestionsResponse> {
    return getSearchSuggestions(this.prisma, owner, args);
  }

  async addBook(owner: Owner, id: string, srcPath: string, meta: EpubMeta): Promise<void> {
    return addBookImpl(this.prisma, this.booksRoot, owner, id, srcPath, meta);
  }

  async deleteBook(owner: Owner, id: string): Promise<Book | null> {
    return deleteBookImpl(this.prisma, this.booksRoot, this.editionsRoot, owner, id);
  }

  /**
   * Deletes all cached device editions (DB rows + on-disk files) for a book
   * across every device. Returns the number cleared, or null when the book
   * does not exist. A rare recovery action for when a book's editions get into
   * a bad state; editions regenerate lazily on the next device download.
   */
  async clearDeviceEditions(owner: Owner, id: string): Promise<number | null> {
    return clearDeviceEditionsImpl(this.prisma, this.booksRoot, this.editionsRoot, owner, id);
  }

  async reimportBook(owner: Owner, id: string): Promise<Book | null> {
    return reimportBookImpl(this.prisma, this.booksRoot, this.editionsRoot, owner, id);
  }

  async getSeriesNextIndex(owner: Owner, name: string): Promise<number> {
    return getSeriesNextIndex(this.prisma, owner, name);
  }

  async scan(
    owner: Owner,
    onProgress?: (progress: ScanProgress) => void
  ): Promise<{ imported: string[]; removed: string[] }> {
    return scanImpl(this.prisma, this.booksRoot, owner, onProgress);
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
}

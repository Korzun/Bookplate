import { PrismaClient, Prisma, Book as BookRow, Series as SeriesRow } from '@prisma/client';

import { Owner, PageCursor, BookListFilters } from '../types';
import { standaloneStatusWhere } from './book-catalog';

/**
 * One page of `Library.entries`, already in the interleaved series/standalone
 * display order — this ordering, not the id/name lookups, is why this stays a
 * function rather than being inlined into the resolver (see `listBooksPage`'s
 * own doc comment).
 *
 * `row` is the real, unselected Prisma row (never a synthetic DTO) — the same
 * invariant `graphql/schema/library-entry/model.ts`'s `LibraryEntryRow` already
 * documents for whatever `Library.entries` hands back. Returning it directly
 * (rather than just `bookId`/`seriesName`, as an earlier revision of this
 * contract did) is what lets the resolver build its `edges` from this single
 * read, with no second `book.findMany`/`series.findMany` to re-fetch rows this
 * function already has in hand.
 */
export type LibraryPageItem =
  | { type: 'series'; seriesName: string; row: SeriesRow }
  | { type: 'standalone'; bookId: string; row: BookRow };

export type LibraryPage = {
  items: LibraryPageItem[];
  /** Opaque cursor for the next page, byte-compatible with `entries-cursor.ts`'s `encodeCursor` — see that file's doc comment. */
  nextCursor: string | null;
};

/**
 * Moved from `BookStore.listBooksPage` (task 8's mechanical-move commit),
 * then changed here to fix the double read that move was staged to make
 * fixable: the old contract fetched standalone rows through a hardcoded
 * `BOOK_SELECT`, discarded them into an `items`/`books` DTO pair, and left
 * every one of the series entries on the page ALSO fetching its member books
 * — none of which `Library.entries` ever used, since that resolver always
 * re-fetched the same rows itself by id/name to get real Pothos-visible
 * `Book`/`Series` objects. For a page mixing standalones and series that was
 * `2 + (number of series on the page)` calls to `prisma.book.findMany` for
 * data that ended up read exactly once by the caller — see
 * `library-page.test.ts`'s "fetches every book exactly once" test, which
 * pins this at exactly 1 regardless of how many series share the page.
 *
 * This function now does the one read the page actually needs — full,
 * unselected `book`/`series` rows, fetched only to determine the interleaved
 * order and the page boundary — and returns those same rows directly as each
 * item's `row`. There is no separate "ids now, hydrate later" step: the ids
 * (`bookId`/`seriesName`) are carried alongside `row` because the resolver
 * needs them for `t: 'b' | 's'` bookkeeping and cursor construction, not
 * because the rows themselves were dropped.
 */
export async function listBooksPage(
  prisma: PrismaClient,
  owner: Owner,
  cursor: PageCursor | null,
  take: number,
  filters?: BookListFilters
): Promise<LibraryPage> {
  // Fetch take+1 from each source so we can detect whether another page exists
  const fetchLimit = take + 1;

  const includeStandalones = filters?.seriesName === undefined && filters?.entryType !== 'series';
  const includeSeries = filters?.entryType !== 'standalone';

  // Pre-fetch progress only when status filter applies to standalone books.
  // Series status is computed at the DB level by seriesIdsForStatus().
  let progressMap: Map<string, number> | null = null;
  if (filters?.status && includeStandalones) {
    const progresses = await prisma.progress.findMany({
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
    matchingSeriesIds = await seriesIdsForStatus(prisma, owner.userId, filters.status);
  }

  const finalSeriesWhere: Prisma.SeriesWhereInput =
    matchingSeriesIds !== null ? { ...seriesWhere, id: { in: matchingSeriesIds } } : seriesWhere;

  // Note: standalone books are sorted by `title`, not `fileAs || title`. This matches the
  // ordering the old client-side UI used (useBookList sorts by title). The OPDS path
  // (listBooks) sorts by fileAs || title, so the two orderings intentionally differ.
  //
  // Neither read carries a `select`: the rows fetched here ARE the rows
  // `Library.entries` hands back as `Book`/`Series` GraphQL nodes (see this
  // function's own doc comment) — the same "always fetch full, unselected
  // rows" invariant `library-entry/model.ts`'s `LibraryEntryRow` doc comment
  // has always documented for this connection, just performed here instead of
  // a second time in the resolver.
  const [seriesRows, standaloneRows] = await Promise.all([
    includeSeries
      ? prisma.series.findMany({
          where: finalSeriesWhere,
          orderBy: { sortKey: 'asc' },
          take: fetchLimit,
        })
      : Promise.resolve([] as SeriesRow[]),
    includeStandalones
      ? prisma.book.findMany({
          where: bookWhere,
          orderBy: [{ title: 'asc' }, { id: 'asc' }],
          take: fetchLimit,
        })
      : Promise.resolve([] as BookRow[]),
  ]);

  // Merge-sort up to take+1 display units to detect overflow.
  // Use binary string comparison (< and <=) to match SQLite's binary collation used
  // in the WHERE/ORDER BY clauses above. Using localeCompare here would disagree with
  // the DB ordering on case and accented characters, causing wrong picks at page
  // boundaries.
  const merged: Array<
    | { sortKey: string; type: 'series'; row: SeriesRow }
    | { sortKey: string; type: 'standalone'; row: BookRow }
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

  const items: LibraryPageItem[] = page.map((p) =>
    p.type === 'series'
      ? { type: 'series' as const, seriesName: p.row.name, row: p.row }
      : { type: 'standalone' as const, bookId: p.row.id, row: p.row }
  );

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

  return { items, nextCursor };
}

async function seriesIdsForStatus(
  prisma: PrismaClient,
  userId: string,
  status: 'not-started' | 'in-progress' | 'completed'
): Promise<string[]> {
  // Compute series status via a single GROUP BY + HAVING aggregate query.
  // LEFT JOIN books so empty series count as not-started (COUNT(b.id) = 0).
  // LEFT JOIN progress on (document, user_id) so unread books have NULL percentage.
  if (status === 'not-started') {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
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
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
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
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
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

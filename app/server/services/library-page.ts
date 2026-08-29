import { PrismaClient, Prisma, Book as BookRow, Series as SeriesRow } from '@prisma/client';

import { Owner, PageCursor, BookListFilters } from '../types';
import { standaloneStatusWhere } from './book-catalog';

/**
 * Every `Book` column a GraphQL `Book` field resolver reads, directly or
 * through a helper — `coverData` (the `Bytes?` cover blob) is the sole
 * omission. Recovered from the pre-refactor `BOOK_SELECT`
 * (`git show 363d33dc:app/server/services/book-store.ts`) rather than
 * reconstructed by hand, then reconciled against a fresh read of every
 * `Book` field resolver (`graphql/schema/book/model.ts`):
 *
 * - `userId` and `seriesId` were added — the old `BOOK_SELECT` fed a hand-
 *   built `Book` DTO (`services/book-catalog.ts`'s `prismaBookToBook`) that
 *   never carried either, but this read hands the row straight to Pothos.
 *   `userId` is read directly by `coverUrl`/`downloadUrl`/`thumbnailUrl`
 *   (via the shared `urlSuffix` helper), `pendingFix`/`hasActionablePendingFix`
 *   (`context.loadPendingFix`), `progress` (`context.loadProgress`),
 *   `lineage` (`context.loadOwner`), and `deviceEditionCount`
 *   (`countForBook`) — and, together with `id`, is the compound primary key
 *   (`@@id([userId, id])`) Pothos's relation fallback re-queries by for
 *   `series`/`validation` below. `seriesId` is the FK column backing
 *   `series: t.relation('seriesRel', ...)`.
 * - `series` (the denormalized string column) was DROPPED — the old
 *   `BOOK_SELECT` carried it for `prismaBookToBook`'s DTO, but no `Book`
 *   field resolver here exposes it (`Book.series` is the `seriesRel`
 *   relation, a distinct column).
 * - The old `BOOK_SELECT`'s nested `validation: { select: { valid: true } }`
 *   was DROPPED: `Book.validation` is `t.relation('validation', ...)` here,
 *   not a hand-mapped field, so Pothos's own relation fallback (keyed on
 *   `userId`/`id`, same mechanism as `series` above) fetches it — a select
 *   on `validation.valid` alone would starve every OTHER `Validation` field
 *   (`threshold`, `validatedAt`, `messageCounts`).
 *
 * Every other column is unchanged from the pre-refactor set: `id`, `title`,
 * `titleSort`, `authorSort`, `publishDate`, `author`, `description`,
 * `publisher`, `seriesIndex`, `identifiers`, `subjects`, `coverMime`,
 * `size`, `mtime`, `addedAt`, `chapterCount`, `chapterSpineMap`,
 * `chapterNames`, `pageCount` — each still read by a `Book` field resolver
 * (`title`/`titleSort`/etc. via `t.exposeString`/`t.exposeInt`/`t.exposeFloat`;
 * `subjects`/`identifiers`/`chapterSpineMap`/`chapterNames` via the `parse*`
 * helpers in `graphql/derive.ts`; `coverMime` via `hasCover`; `mtime` via both
 * `mtime` itself and every `urlSuffix`-built URL's cache-busting `v=`).
 */
const BOOK_SELECT = {
  userId: true,
  id: true,
  title: true,
  titleSort: true,
  authorSort: true,
  publishDate: true,
  author: true,
  description: true,
  publisher: true,
  seriesIndex: true,
  seriesId: true,
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

/** The literal shape `prisma.book.findMany({ select: BOOK_SELECT, ... })` returns. */
type SelectedBookRow = Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>;

/**
 * One page of `Library.entries`, already in the interleaved series/standalone
 * display order — this ordering, not the id/name lookups, is why this stays a
 * function rather than being inlined into the resolver (see `listBooksPage`'s
 * own doc comment).
 *
 * `row` is the real Prisma row (never a synthetic DTO) — the same invariant
 * `graphql/schema/library-entry/model.ts`'s `LibraryEntryRow` already
 * documents for whatever `Library.entries` hands back — but the `Book` half
 * is typed here as the FULL `BookRow` (every column, including `coverData`)
 * because that's the parent shape Pothos generated for `Book`'s GraphQL type
 * from `prisma/schema.prisma`, and there is no Pothos-native way to declare a
 * narrower one. The *runtime* object is narrower — selected via `BOOK_SELECT`
 * above — so this type is a deliberate widening, not an accurate description
 * of what's on the object; see the `SelectedBookRow`-to-`BookRow` cast at the
 * `prisma.book.findMany` call below for exactly where that widening happens
 * and why it's safe.
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
  // The `Series` read carries no `select`: the rows fetched here ARE the
  // rows `Library.entries` hands back as `Book`/`Series` GraphQL nodes (see
  // this function's own doc comment) — the same "always fetch full,
  // unselected rows" invariant `library-entry/model.ts`'s `LibraryEntryRow`
  // doc comment documents for this connection, just performed here instead
  // of a second time in the resolver. `sortKey` — the union `resolveType`'s
  // discriminator (`library/model.ts`) — must never be pruned off this read,
  // which is why it stays fully unselected rather than gaining a `select` of
  // its own.
  //
  // The `Book` read DOES carry a `select` (`BOOK_SELECT` above): that column
  // set cannot affect `resolveType` (`sortKey` only ever comes from the
  // `Series` read above, never from this one), so trimming it is safe in a
  // way a `select` on the `Series` read would not be — see `BOOK_SELECT`'s
  // own doc comment for the column-by-column reconciliation, and
  // `library/model.ts`'s comment on `Library.entries` for why this
  // deferred-until-now.
  const [seriesRows, standaloneRows] = await Promise.all([
    includeSeries
      ? prisma.series.findMany({
          where: finalSeriesWhere,
          orderBy: { sortKey: 'asc' },
          take: fetchLimit,
        })
      : Promise.resolve([] as SeriesRow[]),
    includeStandalones
      ? prisma.book
          .findMany({
            where: bookWhere,
            select: BOOK_SELECT,
            orderBy: [{ title: 'asc' }, { id: 'asc' }],
            take: fetchLimit,
          })
          // Widened from `SelectedBookRow` back to the full `BookRow` Pothos
          // expects for `Book`'s GraphQL type (see `LibraryPageItem`'s doc
          // comment) — this is where the type system's guarantee ends. From
          // here on, the only thing standing between a `Book` field resolver
          // and a silent `undefined` for an omitted column is `BOOK_SELECT`'s
          // own reconciliation against every such resolver, plus
          // `graphql/schema/library/entries.test.ts`'s "Book column
          // selection" tests, which assert both that `coverData` is gone
          // from the `select` and that every field the schema exposes on
          // `Book` still resolves off a row fetched through it.
          .then((rows: SelectedBookRow[]) => rows as unknown as BookRow[])
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

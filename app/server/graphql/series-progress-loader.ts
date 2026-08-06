import type { PrismaClient } from '@prisma/client';

export type SeriesProgressLoader = (userId: string, seriesId: string) => Promise<number | null>;

type SeriesBookRow = { userId: string; seriesId: string | null; id: string };

type PendingLookup = {
  userId: string;
  seriesId: string;
  resolve: (value: number | null) => void;
  reject: (err: unknown) => void;
};

/**
 * Batches `Series.progress` lookups for the life of one request so that a
 * page of N series each resolving the field issues two `findMany` calls
 * total (one for member books, one for progress rows), not N.
 *
 * A direct relative of `createProgressLoader`/`createPendingFixLoader` (same
 * files, `progress-loader.ts`/`pending-fix-loader.ts`) — same problem shape:
 * a per-row aggregate reached from a list (`Library.entries`, priced at
 * `maxSize` 100 — `cost-limit.ts`). It differs from those two in needing a
 * SECOND query, because "a series' progress" isn't a single row keyed by
 * `(userId, seriesId)` the way `Progress`/`PendingFix` are keyed by
 * `(userId, document|bookId)` — it's an aggregate over the series' member
 * `Book` rows, each of which may or may not have its own `Progress` row.
 * Both queries are batched across the WHOLE flush, not one pair per series:
 * `books` is fetched for every pending `(userId, seriesId)` in one
 * `findMany`, and `progress` is then fetched for every book THAT query
 * returned in a second `findMany` — two queries regardless of how many
 * series (or books per series) are in the batch.
 *
 * SEMANTICS — matches `calculateSeriesProgressPercent`
 * (`app/client/src/provider/progress/helper.ts`), the client-side
 * computation `useMySeriesProgress` used before grid rows went fetch-free
 * (task 7): the unweighted MEAN of each member book's progress percentage,
 * treating a book with no `Progress` row as 0%, and `null` — not 0 — when
 * NONE of the series' books have any progress row (an unstarted series
 * reads as "no badge", not "0%"). A series with zero books (bookCount 0, an
 * edge case but not one the schema rules out) also resolves `null`, the
 * same "empty book list" case `calculateSeriesProgressPercent` itself
 * returns `undefined` for (that helper runs client-side against a
 * `number | undefined` return type; this loader is server-side and follows
 * `ProgressLoader`/`PendingFixLoader`'s `| null` convention instead — same
 * "nothing to report" meaning, different transport idiom).
 *
 * Batched by `(userId, seriesId)` pairs, not a single `userId` +
 * `seriesId IN (...)`, mirroring the sibling loaders' stance on
 * `(userId, document|bookId)`: `Series.id` is a globally-unique opaque id
 * (`schema.prisma`'s `Series.id @id`, no compound key), so a bare
 * `seriesId IN (...)` would already scope correctly on its own — but
 * `userId` is carried in every pair anyway, for the same defense-in-depth
 * reasoning `series/node-loader.ts` gives for scoping by owner rather than
 * trusting a global id alone. The follow-up `Progress` lookup DOES need this
 * discipline for real, not just defense-in-depth: `document` is a KOReader
 * content hash and collides across tenants (`progress-loader.ts`'s own doc
 * comment) — so it is fetched as `{userId, document}` pairs read off the
 * `books` rows the first query already scoped correctly, never a bare
 * `document IN (...)`.
 *
 * `cache` and `flush`'s resolve/reject-both discipline mirror the sibling
 * loaders exactly — see `progress-loader.ts`'s doc comment for the fuller
 * rationale (per-key memoization would not collapse N *different* keys into
 * one query; every pending lookup must be settled, even on a thrown query,
 * or an unsettled promise hangs the request instead of surfacing a GraphQL
 * error).
 */
export const createSeriesProgressLoader = (prisma: PrismaClient): SeriesProgressLoader => {
  const cache = new Map<string, Map<string, Promise<number | null>>>();
  let pending: PendingLookup[] = [];
  let flushScheduled = false;

  const flush = async (): Promise<void> => {
    const batch = pending;
    pending = [];
    flushScheduled = false;

    try {
      const books: SeriesBookRow[] = await prisma.book.findMany({
        where: { OR: batch.map(({ userId, seriesId }) => ({ userId, seriesId })) },
        select: { userId: true, seriesId: true, id: true },
      });

      const progressRows =
        books.length > 0
          ? await prisma.progress.findMany({
              where: { OR: books.map((book) => ({ userId: book.userId, document: book.id })) },
              select: { userId: true, document: true, percentage: true },
            })
          : [];

      const percentageByUser = new Map<string, Map<string, number>>();
      for (const row of progressRows) {
        const byDocument = percentageByUser.get(row.userId) ?? new Map<string, number>();
        byDocument.set(row.document, row.percentage);
        percentageByUser.set(row.userId, byDocument);
      }

      const booksBySeries = new Map<string, Map<string, SeriesBookRow[]>>();
      for (const book of books) {
        // Every row here matched a queried `{userId, seriesId}` pair, so
        // `seriesId` is never null in practice — narrowed for the type only.
        if (book.seriesId === null) continue;
        const bySeries = booksBySeries.get(book.userId) ?? new Map<string, SeriesBookRow[]>();
        bySeries.set(book.seriesId, [...(bySeries.get(book.seriesId) ?? []), book]);
        booksBySeries.set(book.userId, bySeries);
      }

      for (const lookup of batch) {
        const seriesBooks = booksBySeries.get(lookup.userId)?.get(lookup.seriesId) ?? [];
        const byDocument = percentageByUser.get(lookup.userId);
        const hasAnyProgress = seriesBooks.some((book) => byDocument?.has(book.id) ?? false);
        if (!hasAnyProgress) {
          lookup.resolve(null);
          continue;
        }
        const total = seriesBooks.reduce((sum, book) => sum + (byDocument?.get(book.id) ?? 0), 0);
        lookup.resolve(total / seriesBooks.length);
      }
    } catch (err) {
      for (const lookup of batch) lookup.reject(err);
    }
  };

  return (userId: string, seriesId: string): Promise<number | null> => {
    const bySeriesId = cache.get(userId) ?? new Map<string, Promise<number | null>>();
    cache.set(userId, bySeriesId);

    const cached = bySeriesId.get(seriesId);
    if (cached !== undefined) return cached;

    const result = new Promise<number | null>((resolve, reject) => {
      pending.push({ userId, seriesId, resolve, reject });
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(() => void flush());
      }
    });
    bySeriesId.set(seriesId, result);
    return result;
  };
};

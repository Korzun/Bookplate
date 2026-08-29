import type { PrismaClient } from '@prisma/client';

import { createPairLoader, type PairLoader } from './pair-loader';

export type SeriesProgressLoader = PairLoader<number | null>;

type SeriesBookRow = { userId: string; seriesId: string | null; id: string };

/**
 * Batches `Series.progressPercentage` so a page of N series issues TWO
 * `findMany` calls total — one for member books, one for their progress rows —
 * not N. See `pair-loader.ts` for the shared mechanics.
 *
 * The two-query shape is why this loader has a hand-written `fetch` rather than
 * a one-liner: "a series' progress" is not a single row keyed by
 * `(userId, seriesId)` the way `Progress`/`PendingFix` are keyed — it is an
 * aggregate over the series' member `Book` rows, each of which may or may not
 * have its own `Progress` row. Both queries are batched across the WHOLE flush,
 * so the count stays at two regardless of how many series (or books per series)
 * are in the batch.
 *
 * SEMANTICS — the unweighted MEAN of each member book's progress percentage,
 * treating a book with no `Progress` row as 0%, and `null` — not 0 — when NONE
 * of the series' books have any progress row (an unstarted series reads as "no
 * badge", not "0%"). A series with zero books also resolves `null`. This
 * matches `calculateSeriesProgressPercent`, the client-side computation
 * `useMySeriesProgress` used before grid rows went fetch-free; that helper is
 * gone, so THIS comment is the authority for the semantics, not a pointer to
 * one.
 *
 * Both "no progress at all" and "series not in the batch result" collapse to
 * the same `null`, which is why `fetch` simply omits an entry for an unstarted
 * series rather than writing an explicit null.
 *
 * Batched by `(userId, seriesId)` pairs even though `Series.id` is globally
 * unique (`schema.prisma`'s `Series.id @id`, no compound key) — defense in
 * depth, the same reasoning `series/node-loader.ts` gives for scoping by owner
 * rather than trusting a global id. The follow-up `Progress` lookup DOES need
 * the discipline for real: `document` is a KOReader content hash and collides
 * across tenants, so it is fetched as `{userId, document}` pairs read off the
 * `books` rows the first query already scoped correctly.
 */
export const createSeriesProgressLoader = (prisma: PrismaClient): SeriesProgressLoader =>
  createPairLoader<number | null>(async (pairs) => {
    const books: SeriesBookRow[] = await prisma.book.findMany({
      where: { OR: pairs.map(({ userId, key }) => ({ userId, seriesId: key })) },
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

    const result = new Map<string, Map<string, number | null>>();
    for (const { userId, key } of pairs) {
      const seriesBooks = booksBySeries.get(userId)?.get(key) ?? [];
      const byDocument = percentageByUser.get(userId);
      const hasAnyProgress = seriesBooks.some((book) => byDocument?.has(book.id) ?? false);
      if (!hasAnyProgress) continue; // absent -> null, per this loader's semantics above
      const total = seriesBooks.reduce((sum, book) => sum + (byDocument?.get(book.id) ?? 0), 0);
      const byKey = result.get(userId) ?? new Map<string, number | null>();
      byKey.set(key, total / seriesBooks.length);
      result.set(userId, byKey);
    }
    return result;
  }, null);

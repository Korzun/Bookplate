import type { PrismaClient } from '@prisma/client';

import { createPairLoader, type PairLoader } from './pair-loader';

export type SeriesRatingLoader = PairLoader<number | null>;

/**
 * Batches `Series.overallRating` so a page of N series issues ONE `findMany`
 * for every member book's `ratingOverall` — not N. A rating is a column on
 * `Book` (`schema.prisma`, the book-ratings spec), so unlike
 * `series-progress.ts` there is no second table to join: one query over the
 * batch's `(userId, seriesId)` pairs is the whole fetch.
 *
 * SEMANTICS — the MEAN of the RATED members' Overall, rounded DOWN to a step
 * (one Great and one Love read as Great: a series only earns the higher word
 * when every member reaches it), and `null` when no member
 * book is rated. An unrated member is left out of the average rather than
 * counted as anything: a series where one of five books is rated 4 reads as
 * a 4, which is what the reader actually said about it. This is deliberately
 * NOT progress's rule (where a missing row counts as 0%): an unread book has
 * genuinely contributed no progress, whereas an unrated one has contributed
 * no opinion. A series with zero books resolves `null` too.
 *
 * Batched by `(userId, seriesId)` pairs even though `Series.id` is globally
 * unique — the same defense-in-depth scoping `series-progress.ts` gives.
 */
export const createSeriesRatingLoader = (prisma: PrismaClient): SeriesRatingLoader =>
  createPairLoader<number | null>(async (pairs) => {
    const books = await prisma.book.findMany({
      where: {
        OR: pairs.map(({ userId, key }) => ({ userId, seriesId: key })),
        ratingOverall: { not: null },
      },
      select: { userId: true, seriesId: true, ratingOverall: true },
    });

    const totals = new Map<string, Map<string, { sum: number; count: number }>>();
    for (const book of books) {
      if (book.seriesId === null || book.ratingOverall === null) continue;
      const bySeries = totals.get(book.userId) ?? new Map<string, { sum: number; count: number }>();
      const current = bySeries.get(book.seriesId) ?? { sum: 0, count: 0 };
      bySeries.set(book.seriesId, {
        sum: current.sum + book.ratingOverall,
        count: current.count + 1,
      });
      totals.set(book.userId, bySeries);
    }

    const result = new Map<string, Map<string, number | null>>();
    for (const [userId, bySeries] of totals) {
      const byKey = new Map<string, number | null>();
      for (const [seriesId, { sum, count }] of bySeries) {
        byKey.set(seriesId, Math.floor(sum / count));
      }
      result.set(userId, byKey);
    }
    return result;
  }, null);

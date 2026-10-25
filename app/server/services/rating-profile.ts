import type { Book, Prisma, PrismaClient } from '@prisma/client';

import { RATING_COLUMNS, RATING_FIELDS, type RatingFieldName } from './rating';

export type RatingFieldSummary = {
  field: RatingFieldName;
  count: number;
  mean: number | null;
  distribution: [number, number, number, number, number];
};

async function summarise(
  prisma: PrismaClient,
  userId: string,
  field: RatingFieldName
): Promise<RatingFieldSummary> {
  const column = RATING_COLUMNS[field];
  const groups = await prisma.book.groupBy({
    by: [column],
    where: { userId, [column]: { not: null } },
    _count: { _all: true },
  });
  const distribution: RatingFieldSummary['distribution'] = [0, 0, 0, 0, 0];
  let count = 0;
  let sum = 0;
  for (const group of groups) {
    const value = group[column];
    if (value === null || value < 1 || value > 5) continue;
    const n = group._count._all;
    distribution[value - 1] += n;
    count += n;
    sum += value * n;
  }
  // Derived from the distribution, never a float aggregate, so it is exact.
  return { field, count, mean: count === 0 ? null : sum / count, distribution };
}

export function ratingSummaries(
  prisma: PrismaClient,
  userId: string
): Promise<RatingFieldSummary[]> {
  return Promise.all(RATING_FIELDS.map((field) => summarise(prisma, userId, field)));
}

export function ratedCount(prisma: PrismaClient, userId: string): Promise<number> {
  return prisma.book.count({ where: { userId, ratingOverall: { not: null } } });
}

/**
 * The caller clamps `minOverall` and `first`. `extra` carries Pothos's planned
 * `include`/`select` so nested selections resolve without extra queries.
 */
export function favouriteBooks(
  prisma: PrismaClient,
  userId: string,
  minOverall: number,
  first: number,
  extra: Pick<Prisma.BookFindManyArgs, 'include' | 'select'> = {}
): Promise<Book[]> {
  return prisma.book.findMany({
    ...extra,
    where: { userId, ratingOverall: { gte: minOverall } },
    orderBy: [{ ratedAt: 'desc' }, { title: 'asc' }],
    take: first,
  });
}

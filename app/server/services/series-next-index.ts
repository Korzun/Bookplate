import { PrismaClient } from '@prisma/client';

import { Owner } from '../types';

export async function getSeriesNextIndex(
  prisma: PrismaClient,
  owner: Owner,
  name: string
): Promise<number> {
  const result = await prisma.book.aggregate({
    where: { userId: owner.userId, series: name },
    _max: { seriesIndex: true },
  });
  const max = result._max.seriesIndex;
  return max == null ? 1 : Math.floor(max) + 1;
}

import { PrismaClient, Prisma } from '@prisma/client';

import { logger } from '../logger';
import { Progress, ProgressPageCursor } from '../types';

const log = logger('progress');

export async function getProgress(
  prisma: PrismaClient,
  userId: string,
  document: string
): Promise<Progress | null> {
  const row = await prisma.progress.findUnique({
    where: { userId_document: { userId, document } },
  });
  if (!row) return null;
  return {
    document: row.document,
    progress: row.progress,
    percentage: row.percentage,
    device: row.device,
    device_id: row.deviceId,
    timestamp: row.timestamp,
  };
}

export async function saveProgress(
  prisma: PrismaClient,
  userId: string,
  p: Omit<Progress, 'timestamp'> & { timestamp?: number }
): Promise<Progress> {
  const timestamp = p.timestamp ?? Math.floor(Date.now() / 1000);
  await prisma.progress.upsert({
    where: { userId_document: { userId, document: p.document } },
    create: {
      userId,
      document: p.document,
      progress: p.progress,
      percentage: p.percentage,
      device: p.device,
      deviceId: p.device_id,
      timestamp,
    },
    update: {
      progress: p.progress,
      percentage: p.percentage,
      device: p.device,
      deviceId: p.device_id,
      timestamp,
    },
  });
  try {
    const recent = await prisma.progressHistory.findFirst({
      where: { userId, document: p.document, progress: p.progress, deviceId: p.device_id },
      orderBy: { endTimestamp: 'desc' },
    });
    if (recent && timestamp >= recent.endTimestamp && timestamp - recent.endTimestamp <= 600) {
      await prisma.progressHistory.update({
        where: { id: recent.id },
        data: { endTimestamp: timestamp },
      });
    } else {
      await prisma.progressHistory.create({
        data: {
          userId,
          document: p.document,
          progress: p.progress,
          percentage: p.percentage,
          device: p.device,
          deviceId: p.device_id,
          startTimestamp: timestamp,
          endTimestamp: timestamp,
        },
      });
    }
  } catch (err) {
    log.warn(`Progress history write failed for user ${userId}: ${String(err)}`);
  }
  return { ...p, timestamp };
}

/**
 * Keyset-paginated progress for a user, ordered by timestamp desc then
 * document asc. Fetches take+1 rows to detect a further page; `nextCursor`
 * is a base64-encoded { timestamp, document } of the last row, or null.
 */
export async function getUserProgressPage(
  prisma: PrismaClient,
  userId: string,
  cursor: ProgressPageCursor | null,
  take: number
): Promise<{ items: Progress[]; nextCursor: string | null }> {
  const rows = await prisma.progress.findMany({
    where: {
      userId,
      ...(cursor
        ? {
            OR: [
              { timestamp: { lt: cursor.timestamp } },
              { timestamp: cursor.timestamp, document: { gt: cursor.document } },
            ],
          }
        : {}),
    },
    orderBy: [{ timestamp: 'desc' }, { document: 'asc' }],
    take: take + 1,
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const items: Progress[] = page.map((row) => ({
    document: row.document,
    progress: row.progress,
    percentage: row.percentage,
    device: row.device,
    device_id: row.deviceId,
    timestamp: row.timestamp,
  }));
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? Buffer.from(
          JSON.stringify({ timestamp: last.timestamp, document: last.document })
        ).toString('base64')
      : null;
  return { items, nextCursor };
}

export async function clearProgress(
  prisma: PrismaClient,
  userId: string,
  document: string
): Promise<boolean> {
  try {
    await prisma.progress.delete({
      where: { userId_document: { userId, document } },
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return false;
    }
    throw e;
  }
}

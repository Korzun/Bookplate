import { PrismaClient } from '@prisma/client';

import { logger } from '../logger';
import { Progress } from '../types';
import { isPrismaError } from './prisma-errors';

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
    if (isPrismaError(e, 'P2025')) {
      return false;
    }
    throw e;
  }
}

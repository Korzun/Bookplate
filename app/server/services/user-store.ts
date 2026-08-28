import { PrismaClient, Prisma } from '@prisma/client';

import { logger } from '../logger';
import { Owner, Progress, ProgressPageCursor } from '../types';
import { generateUserId } from '../utils/id';
import { purgeForUser } from './edition';
import { generateSyncPassword } from './password';

const log = logger('UserStore');

export class UserStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly editionsRoot: string
  ) {}

  async createUser(
    username: string,
    passwordHash: string | null,
    syncPassword?: string,
    mustChangePassword?: boolean
  ): Promise<boolean> {
    try {
      await this.prisma.user.create({
        data: {
          id: generateUserId(),
          username,
          passwordHash,
          syncPassword: syncPassword ?? generateSyncPassword(),
          mustChangePassword: mustChangePassword ?? false,
        },
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return false;
      }
      throw e;
    }
  }

  async getMustChangePassword(username: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({
      where: { username },
      select: { mustChangePassword: true },
    });
    return row?.mustChangePassword ?? false;
  }

  async getUserIdByUsername(username: string): Promise<string | null> {
    const row = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async getProgress(userId: string, document: string): Promise<Progress | null> {
    const row = await this.prisma.progress.findUnique({
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

  async saveProgress(
    userId: string,
    p: Omit<Progress, 'timestamp'> & { timestamp?: number }
  ): Promise<Progress> {
    const timestamp = p.timestamp ?? Math.floor(Date.now() / 1000);
    await this.prisma.progress.upsert({
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
      const recent = await this.prisma.progressHistory.findFirst({
        where: { userId, document: p.document, progress: p.progress, deviceId: p.device_id },
        orderBy: { endTimestamp: 'desc' },
      });
      if (recent && timestamp >= recent.endTimestamp && timestamp - recent.endTimestamp <= 600) {
        await this.prisma.progressHistory.update({
          where: { id: recent.id },
          data: { endTimestamp: timestamp },
        });
      } else {
        await this.prisma.progressHistory.create({
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

  async userExists(username: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({
      where: { username },
      select: { username: true },
    });
    return row !== null;
  }

  async listUsers(): Promise<{ username: string; progressCount: number }[]> {
    const rows = await this.prisma.user.findMany({
      orderBy: { username: 'asc' },
      include: { _count: { select: { progresses: true } } },
    });
    return rows.map((row) => ({
      username: row.username,
      progressCount: row._count.progresses,
    }));
  }

  async listOwners(): Promise<Owner[]> {
    const rows = await this.prisma.user.findMany({
      select: { id: true, username: true },
      orderBy: { username: 'asc' },
    });
    return rows.map((r) => ({ userId: r.id, username: r.username }));
  }

  /**
   * Keyset-paginated progress for a user, ordered by timestamp desc then
   * document asc. Fetches take+1 rows to detect a further page; `nextCursor`
   * is a base64-encoded { timestamp, document } of the last row, or null.
   */
  async getUserProgressPage(
    userId: string,
    cursor: ProgressPageCursor | null,
    take: number
  ): Promise<{ items: Progress[]; nextCursor: string | null }> {
    const rows = await this.prisma.progress.findMany({
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

  async clearProgress(userId: string, document: string): Promise<boolean> {
    try {
      await this.prisma.progress.delete({
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

  async deleteUser(username: string): Promise<boolean> {
    let userId: string;
    try {
      const deleted = await this.prisma.user.delete({ where: { username } });
      userId = deleted.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return false;
      }
      throw e;
    }
    try {
      await purgeForUser(this.prisma, this.editionsRoot, userId);
    } catch (err) {
      log.warn(
        `deleteUser: edition-cache purge failed for "${userId}" — ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return true;
  }
}

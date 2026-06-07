import { PrismaClient, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { Progress } from '../types';

export class UserStore {
  constructor(private readonly prisma: PrismaClient) {}

  static hashPassword(password: string): string {
    return crypto.createHash('md5').update(password).digest('hex');
  }

  async createUser(username: string, key: string): Promise<boolean> {
    try {
      await this.prisma.user.create({ data: { username, key } });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return false; // unique constraint — duplicate username
      }
      throw e;
    }
  }

  async authenticate(username: string, key: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({
      where: { username },
      select: { key: true },
    });
    return row?.key === key;
  }

  async validateUser(username: string, password: string): Promise<boolean> {
    return this.authenticate(username, UserStore.hashPassword(password));
  }

  async getProgress(username: string, document: string): Promise<Progress | null> {
    const row = await this.prisma.progress.findUnique({
      where: { username_document: { username, document } },
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
    username: string,
    p: Omit<Progress, 'timestamp'> & { timestamp?: number }
  ): Promise<Progress> {
    const timestamp = p.timestamp ?? Math.floor(Date.now() / 1000);
    await this.prisma.progress.upsert({
      where: { username_document: { username, document: p.document } },
      create: {
        username,
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

  async getUserProgress(username: string): Promise<Progress[]> {
    const rows = await this.prisma.progress.findMany({
      where: { username },
      orderBy: { timestamp: 'desc' },
    });
    return rows.map((row) => ({
      document: row.document,
      progress: row.progress,
      percentage: row.percentage,
      device: row.device,
      device_id: row.deviceId,
      timestamp: row.timestamp,
    }));
  }

  async clearProgress(username: string, document: string): Promise<boolean> {
    try {
      await this.prisma.progress.delete({
        where: { username_document: { username, document } },
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return false; // record not found
      }
      throw e;
    }
  }

  async changePassword(username: string, key: string): Promise<boolean> {
    try {
      await this.prisma.user.update({ where: { username }, data: { key } });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return false;
      }
      throw e;
    }
  }

  async deleteUser(username: string): Promise<boolean> {
    try {
      // Explicitly delete progress first — the progress table has no FK constraint
      // to users, so we cannot rely on database-level cascading.
      await this.prisma.$transaction(async (tx) => {
        await tx.progress.deleteMany({ where: { username } });
        await tx.user.delete({ where: { username } });
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return false; // user not found
      }
      throw e;
    }
  }
}

import { PrismaClient, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { customAlphabet } from 'nanoid';
import { Progress } from '../types';

const generateId = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  21
);

export class UserStore {
  constructor(private readonly prisma: PrismaClient) {}

  static hashPassword(password: string): string {
    return crypto.createHash('md5').update(password).digest('hex');
  }

  async createUser(username: string, key: string): Promise<boolean> {
    try {
      await this.prisma.user.create({ data: { id: generateId(), username, key } });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return false; // unique constraint — duplicate username
      }
      throw e;
    }
  }

  async authenticate(username: string, key: string): Promise<string | false> {
    const row = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true, key: true },
    });
    if (!row || row.key !== key) return false;
    return row.id;
  }

  async validateUser(username: string, password: string): Promise<string | false> {
    return this.authenticate(username, UserStore.hashPassword(password));
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

  async getUserProgress(userId: string): Promise<Progress[]> {
    const rows = await this.prisma.progress.findMany({
      where: { userId },
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
    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { username }, select: { id: true } });
        if (!user)
          throw new Prisma.PrismaClientKnownRequestError('Not found', {
            code: 'P2025',
            clientVersion: '',
          });
        await tx.progress.deleteMany({ where: { userId: user.id } });
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

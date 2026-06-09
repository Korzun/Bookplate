import { PrismaClient, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import argon2 from 'argon2';
import { Progress } from '../types';
import { generateUserId } from '../utils/id';
import { WORDLIST } from './wordlist';

export class UserStore {
  constructor(private readonly prisma: PrismaClient) {}

  static generateSyncPassword(): string {
    let attempts = 0;
    while (attempts < 200) {
      const w1 = WORDLIST[Math.floor(Math.random() * WORDLIST.length)];
      const w2 = WORDLIST[Math.floor(Math.random() * WORDLIST.length)];
      if ((w1 + ' ' + w2).length <= 15) return `${w1} ${w2}`;
      attempts++;
    }
    return 'blue oak'; // all wordlist words are ≤7 chars so this is unreachable in practice
  }

  static hashSyncPassword(syncPassword: string): string {
    return crypto.createHash('md5').update(syncPassword).digest('hex');
  }

  static async hashLoginPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  static async verifyLoginPassword(password: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  async createUser(
    username: string,
    passwordHash: string | null,
    syncPassword?: string
  ): Promise<boolean> {
    try {
      await this.prisma.user.create({
        data: {
          id: generateUserId(),
          username,
          passwordHash,
          syncPassword: syncPassword ?? UserStore.generateSyncPassword(),
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

  async authenticate(username: string, key: string): Promise<string | false> {
    const row = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true, syncPassword: true },
    });
    if (row === null || row.syncPassword === null) return false;
    if (UserStore.hashSyncPassword(row.syncPassword) !== key) return false;
    return row.id;
  }

  async authenticateSync(username: string, key: string): Promise<boolean> {
    return !!(await this.authenticate(username, key));
  }

  async validateUser(username: string, password: string): Promise<string | false> {
    const row = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true, passwordHash: true },
    });
    if (!row?.passwordHash) return false;
    const valid = await UserStore.verifyLoginPassword(password, row.passwordHash);
    return valid ? row.id : false;
  }

  async userHasPassword(username: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({
      where: { username },
      select: { passwordHash: true },
    });
    return !!row?.passwordHash;
  }

  async changePassword(username: string, passwordHash: string): Promise<boolean> {
    try {
      await this.prisma.user.update({ where: { username }, data: { passwordHash } });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return false;
      }
      throw e;
    }
  }

  async getSyncPassword(username: string): Promise<string | null> {
    const row = await this.prisma.user.findUnique({
      where: { username },
      select: { syncPassword: true },
    });
    if (row === null) return null;
    if (row.syncPassword !== null) return row.syncPassword;
    const generated = UserStore.generateSyncPassword();
    await this.prisma.user.update({ where: { username }, data: { syncPassword: generated } });
    return generated;
  }

  async changeSyncPassword(username: string, syncPassword: string): Promise<boolean> {
    try {
      await this.prisma.user.update({ where: { username }, data: { syncPassword } });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return false;
      }
      throw e;
    }
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
      await this.prisma.user.delete({ where: { username } });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return false;
      }
      throw e;
    }
  }
}

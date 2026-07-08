import { PrismaClient, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import argon2 from 'argon2';
import { Owner, Progress, ProgressPageCursor } from '../types';
import { generateUserId } from '../utils/id';
import { WORDLIST } from './wordlist';
import { logger } from '../logger';

const log = logger('UserStore');

const LOGIN_PASSWORD_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const LOGIN_PASSWORD_LENGTH = 16;

/**
 * Minimal structural interface for purging cached device editions when a user
 * is deleted. Kept separate from a concrete EditionStore class to avoid a
 * hard dependency from UserStore onto the edition-store module. Mirrors
 * BookStore's EditionPurger.
 */
export interface EditionUserPurger {
  purgeForUser(userId: string): Promise<void>;
}

export class UserStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly editionStore?: EditionUserPurger
  ) {}

  static generateSyncPassword(): string {
    let attempts = 0;
    while (attempts < 200) {
      const w1 = WORDLIST[crypto.randomInt(WORDLIST.length)];
      const w2 = WORDLIST[crypto.randomInt(WORDLIST.length)];
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

  static generateLoginPassword(): string {
    let password = '';
    for (let i = 0; i < LOGIN_PASSWORD_LENGTH; i++) {
      password += LOGIN_PASSWORD_CHARSET[crypto.randomInt(LOGIN_PASSWORD_CHARSET.length)];
    }
    return password;
  }

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
          syncPassword: syncPassword ?? UserStore.generateSyncPassword(),
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
      await this.prisma.user.update({
        where: { username },
        data: { passwordHash, mustChangePassword: false },
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return false;
      }
      throw e;
    }
  }

  async resetPassword(username: string): Promise<string | null> {
    const password = UserStore.generateLoginPassword();
    const passwordHash = await UserStore.hashLoginPassword(password);
    try {
      await this.prisma.user.update({
        where: { username },
        data: { passwordHash, mustChangePassword: true },
      });
      return password;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return null;
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
    if (this.editionStore) {
      try {
        await this.editionStore.purgeForUser(userId);
      } catch (err) {
        log.warn(
          `deleteUser: edition-cache purge failed for "${userId}" — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    return true;
  }
}

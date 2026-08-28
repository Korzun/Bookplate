import { PrismaClient, Prisma } from '@prisma/client';

import { logger } from '../logger';
import { Owner } from '../types';
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

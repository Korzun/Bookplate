import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const JWT_SECRET_KEY = 'jwtSecret';

export type RefreshIdentity = { username: string; userId: string | null };

/**
 * Persistence for JWT auth: rotating refresh tokens (only the SHA-256 hash is
 * stored) and the HS256 signing secret (generated on first boot, kept in the
 * settings table so tokens survive restarts).
 */
export class TokenStore {
  constructor(private readonly prisma: PrismaClient) {}

  static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async getOrCreateJwtSecret(): Promise<Buffer> {
    const existing = await this.prisma.setting.findUnique({ where: { key: JWT_SECRET_KEY } });
    if (existing) return Buffer.from(existing.value, 'hex');
    // On conflict the empty update is a no-op and upsert returns the first
    // writer's row, so concurrent first boots converge on one secret.
    const row = await this.prisma.setting.upsert({
      where: { key: JWT_SECRET_KEY },
      create: { key: JWT_SECRET_KEY, value: crypto.randomBytes(32).toString('hex') },
      update: {},
    });
    return Buffer.from(row.value, 'hex');
  }

  async createRefreshToken(identity: RefreshIdentity): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: TokenStore.hashToken(token),
        userId: identity.userId,
        username: identity.username,
        expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
      },
    });
    return token;
  }

  /**
   * Validates and deletes (rotates out) the presented token in one step.
   * Returns the identity it was issued for, or null if unknown or expired.
   */
  async consumeRefreshToken(token: string): Promise<RefreshIdentity | null> {
    const tokenHash = TokenStore.hashToken(token);
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!row) return null;
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash } });
    if (row.expiresAt <= Date.now()) return null;
    return { username: row.username, userId: row.userId };
  }

  async revokeRefreshToken(token: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { tokenHash: TokenStore.hashToken(token) },
    });
  }

  async revokeAllForUsername(username: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { username } });
  }

  async deleteExpired(): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lte: Date.now() } } });
  }
}

import * as crypto from 'crypto';

import { PrismaClient } from '@prisma/client';

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const JWT_SECRET_KEY = 'jwt_secret';

export type RefreshIdentity = { username: string; userId: string | null };

/**
 * Persistence for JWT auth: rotating refresh tokens (only the SHA-256 hash is
 * stored) and the HS256 signing secret (generated on first boot, kept in the
 * settings table so tokens survive restarts).
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function getOrCreateJwtSecret(prisma: PrismaClient): Promise<Buffer> {
  const existing = await prisma.setting.findUnique({ where: { key: JWT_SECRET_KEY } });
  if (existing) return Buffer.from(existing.value, 'hex');
  // On conflict the empty update is a no-op and upsert returns the first
  // writer's row, so concurrent first boots converge on one secret.
  const row = await prisma.setting.upsert({
    where: { key: JWT_SECRET_KEY },
    create: { key: JWT_SECRET_KEY, value: crypto.randomBytes(32).toString('hex') },
    update: {},
  });
  return Buffer.from(row.value, 'hex');
}

export async function createRefreshToken(
  prisma: PrismaClient,
  identity: RefreshIdentity
): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(token),
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
 * A single DELETE...RETURNING keeps consumption atomic: of two concurrent
 * presentations of the same token, exactly one wins.
 */
export async function consumeRefreshToken(
  prisma: PrismaClient,
  token: string
): Promise<RefreshIdentity | null> {
  const tokenHash = hashToken(token);
  const rows = await prisma.$queryRaw<
    Array<{ username: string; user_id: string | null; expires_at: number }>
  >`DELETE FROM refresh_tokens WHERE token_hash = ${tokenHash} RETURNING username, user_id, expires_at`;
  const row = rows[0];
  if (!row) return null;
  if (Number(row.expires_at) <= Date.now()) return null;
  return { username: row.username, userId: row.user_id };
}

export async function revokeRefreshToken(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.refreshToken.deleteMany({
    where: { tokenHash: hashToken(token) },
  });
}

export async function revokeAllForUsername(prisma: PrismaClient, username: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { username } });
}

export async function deleteExpired(prisma: PrismaClient): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { expiresAt: { lte: Date.now() } } });
}

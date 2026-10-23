/**
 * Every read and write of `mcp_tokens` — the per-reader bearer tokens an AI
 * agent presents to `/mcp` (`routes/mcp.ts`).
 *
 * A token is `bpmcp_` + 32 random bytes (base64url). Only its SHA-256 is
 * stored; the plaintext is returned exactly once, by `createMcpToken`, and is
 * unrecoverable afterwards. A fast unsalted hash is correct for a 256-bit
 * random secret — there is no dictionary to defend against — and it lets
 * `authenticateMcpToken` look the row up by an indexed equality rather than
 * scanning and verifying every row.
 *
 * Deliberately a credential of its own, not the login password or the sync
 * (device) password: the sync password is typed into e-readers and is
 * read-mostly in power (OPDS downloads, KOSync progress), whereas an MCP token
 * can edit and replace books. Separate tokens can be revoked one agent at a
 * time without touching any device.
 */
import { createHash, randomBytes, randomUUID } from 'crypto';

import type { PrismaClient } from '@prisma/client';

/**
 * How many agent tokens one reader may hold. Fixed, not an add-on option — same
 * reasoning as `MAX_PUSH_SUBSCRIPTIONS_PER_USER`: nobody will tune it, and a
 * cap keeps a scripted create loop from growing the table without bound.
 */
export const MAX_MCP_TOKENS_PER_USER = 20;

/** Longest label accepted, after trimming. */
export const MCP_TOKEN_LABEL_MAX_LENGTH = 100;

const TOKEN_PREFIX = 'bpmcp_';

/**
 * `lastUsedAt` is a hint for a human deciding which token to revoke, not an
 * audit log, so it is written at most once per this window per token. Every
 * MCP tool call authenticates, and an unthrottled write would turn each one
 * into a SQLite write.
 */
const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;

export type McpTokenRow = {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
};

/** Who a valid token acts as, plus the token row itself (for revocation checks). */
export type McpTokenIdentity = {
  tokenId: string;
  userId: string;
  username: string;
};

export const hashMcpToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Returns `null` when the reader already holds `MAX_MCP_TOKENS_PER_USER`
 * tokens. The count and the insert share one transaction so two concurrent
 * creates cannot both pass the check (the `upsertPushSubscription` shape).
 */
export async function createMcpToken(
  prisma: PrismaClient,
  args: { userId: string; label: string; now?: number }
): Promise<{ row: McpTokenRow; token: string } | null> {
  const now = args.now ?? Date.now();
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return prisma.$transaction(async (tx) => {
    const count = await tx.mcpToken.count({ where: { userId: args.userId } });
    if (count >= MAX_MCP_TOKENS_PER_USER) return null;
    const row = await tx.mcpToken.create({
      data: {
        id: randomUUID(),
        userId: args.userId,
        label: args.label,
        tokenHash: hashMcpToken(token),
        createdAt: now,
      },
      select: { id: true, label: true, createdAt: true, lastUsedAt: true },
    });
    return { row, token };
  });
}

export async function listMcpTokenRows(
  prisma: PrismaClient,
  userId: string
): Promise<McpTokenRow[]> {
  return prisma.mcpToken.findMany({
    where: { userId },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Scoped to the owner in the WHERE clause, so "not yours" and "no such token"
 * are the same `false` — the `deletePushSubscription` shape.
 */
export async function deleteMcpToken(
  prisma: PrismaClient,
  args: { userId: string; id: string }
): Promise<boolean> {
  const { count } = await prisma.mcpToken.deleteMany({
    where: { id: args.id, userId: args.userId },
  });
  return count > 0;
}

/**
 * Resolves a presented token to the reader it acts as, or `null`. Anything not
 * shaped like one of ours is rejected before touching the database.
 *
 * The config admin never holds a token (`viewerCreateMcpToken` refuses it), but
 * `isConfigAdmin` is still excluded here so a row that somehow pointed at it
 * could not act as a library-less reader.
 */
export async function authenticateMcpToken(
  prisma: PrismaClient,
  token: string,
  now: number = Date.now()
): Promise<McpTokenIdentity | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashMcpToken(token) },
    select: {
      id: true,
      lastUsedAt: true,
      user: { select: { id: true, username: true, isConfigAdmin: true } },
    },
  });
  if (row === null || row.user.isConfigAdmin) return null;
  if (row.lastUsedAt === null || now - row.lastUsedAt >= LAST_USED_WRITE_INTERVAL_MS) {
    // `updateMany`: the token may be revoked between the read and this write,
    // and a revoked token's bookkeeping is not worth a P2025.
    await prisma.mcpToken.updateMany({ where: { id: row.id }, data: { lastUsedAt: now } });
  }
  return { tokenId: row.id, userId: row.user.id, username: row.user.username };
}

/**
 * True while the token a transfer ticket was minted under still exists and
 * still belongs to the same reader — so revoking a token also kills any
 * upload/download URL handed out under it (`mcp/transfer-ticket.ts`).
 */
export async function mcpTokenIsLive(
  prisma: PrismaClient,
  args: { tokenId: string; userId: string }
): Promise<boolean> {
  const row = await prisma.mcpToken.findFirst({
    where: { id: args.tokenId, userId: args.userId },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Every read and write of the OAuth tables behind `/mcp`: registered clients
 * (`oauth_clients`) and the grants readers approved for them (`oauth_grants`).
 * The protocol itself — request parsing, PKCE, error formats — is the MCP
 * SDK's handlers' (`mcp/oauth-provider.ts` wires them to this module); this
 * module only decides what is stored and what a token means.
 *
 * One grant row is one connected agent. It holds exactly one live access token
 * and one live refresh token, by SHA-256 only. Each token is 32 random bytes,
 * so a fast unsalted hash is the right tool (nothing to brute-force) and makes
 * every lookup an indexed equality. Refreshing rotates both in place;
 * deleting the row revokes both at once.
 *
 * A grant only ever belongs to a reader: the config admin owns no library, so
 * the consent step refuses it (`routes/mcp-oauth.ts`) and token verification
 * refuses a grant that somehow points at it.
 */
import { createHash, randomBytes, randomUUID } from 'crypto';

import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { PrismaClient } from '@prisma/client';

/** The one scope this server grants: the reader's whole library, read and write. */
export const MCP_SCOPE = 'library';

/**
 * An hour, like most OAuth servers: short enough that a leaked access token
 * goes stale on its own, long enough that an agent refreshes rarely.
 */
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Sliding: every refresh pushes it out again, so a grant in use never expires
 * and one abandoned for this long stops working without anyone revoking it.
 */
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** `lastUsedAt` is a hint for the settings list, not an audit log. */
const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;

const ACCESS_PREFIX = 'bpat_';
const REFRESH_PREFIX = 'bprt_';

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');
const mint = (prefix: string): string => `${prefix}${randomBytes(32).toString('base64url')}`;

// ── Clients ─────────────────────────────────────────────────────────────────────────

/** The name a reader sees for a client: its self-declared name, else its host. */
function displayName(client: Omit<OAuthClientInformationFull, 'client_id'>): string {
  const name = client.client_name?.trim();
  if (name) return name.slice(0, 100);
  try {
    return new URL(client.redirect_uris[0]).host || 'Unnamed agent';
  } catch {
    return 'Unnamed agent';
  }
}

export async function getOAuthClient(
  prisma: PrismaClient,
  clientId: string
): Promise<OAuthClientInformationFull | undefined> {
  const row = await prisma.oAuthClient.findUnique({
    where: { id: clientId },
    select: { metadata: true },
  });
  return row === null ? undefined : (JSON.parse(row.metadata) as OAuthClientInformationFull);
}

/**
 * Stores a client the SDK's registration handler has already validated
 * (RFC 7591 metadata) and, for a confidential client, given a secret. The
 * secret is stored as issued because the SDK's client authentication compares
 * it in plaintext; a dynamically registered client's secret guards nothing a
 * reader has not separately approved, so this is not the place for a hash.
 */
export async function registerOAuthClient(
  prisma: PrismaClient,
  client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
  now: number = Date.now()
): Promise<OAuthClientInformationFull> {
  const full: OAuthClientInformationFull = {
    ...client,
    client_id: randomUUID(),
    client_id_issued_at: Math.floor(now / 1000),
  };
  await prisma.oAuthClient.create({
    data: {
      id: full.client_id,
      name: displayName(full),
      metadata: JSON.stringify(full),
      createdAt: now,
    },
  });
  return full;
}

// ── Grants ──────────────────────────────────────────────────────────────────────────

function tokenPair(now: number) {
  const accessToken = mint(ACCESS_PREFIX);
  const refreshToken = mint(REFRESH_PREFIX);
  return {
    accessToken,
    refreshToken,
    columns: {
      accessTokenHash: hash(accessToken),
      accessExpiresAt: now + ACCESS_TOKEN_TTL_MS,
      refreshTokenHash: hash(refreshToken),
      refreshExpiresAt: now + REFRESH_TOKEN_TTL_MS,
    },
  };
}

const tokensResponse = (pair: ReturnType<typeof tokenPair>, scope: string): OAuthTokens => ({
  access_token: pair.accessToken,
  token_type: 'Bearer',
  expires_in: ACCESS_TOKEN_TTL_MS / 1000,
  refresh_token: pair.refreshToken,
  scope,
});

/** A new connected agent: called once its reader has approved it and the code is redeemed. */
export async function createOAuthGrant(
  prisma: PrismaClient,
  args: { userId: string; clientId: string; resource: string; now?: number }
): Promise<OAuthTokens> {
  const now = args.now ?? Date.now();
  const pair = tokenPair(now);
  await prisma.oAuthGrant.create({
    data: {
      id: randomUUID(),
      userId: args.userId,
      clientId: args.clientId,
      scope: MCP_SCOPE,
      resource: args.resource,
      createdAt: now,
      ...pair.columns,
    },
  });
  return tokensResponse(pair, MCP_SCOPE);
}

/**
 * Rotates a grant's tokens for a valid, unexpired refresh token presented by
 * the client it was issued to; `null` otherwise. The update is conditional on
 * the old refresh hash, so two concurrent refreshes with one token cannot both
 * succeed — the loser gets `null` (invalid_grant), as a reused rotated-out
 * token should.
 */
export async function refreshOAuthGrant(
  prisma: PrismaClient,
  args: { clientId: string; refreshToken: string; now?: number }
): Promise<OAuthTokens | null> {
  const now = args.now ?? Date.now();
  const oldHash = hash(args.refreshToken);
  const grant = await prisma.oAuthGrant.findUnique({
    where: { refreshTokenHash: oldHash },
    select: { id: true, clientId: true, scope: true, refreshExpiresAt: true },
  });
  if (grant === null || grant.clientId !== args.clientId || grant.refreshExpiresAt <= now) {
    return null;
  }
  const pair = tokenPair(now);
  const { count } = await prisma.oAuthGrant.updateMany({
    where: { id: grant.id, refreshTokenHash: oldHash },
    data: pair.columns,
  });
  return count === 1 ? tokensResponse(pair, grant.scope) : null;
}

/** Who a valid access token acts as. */
export type OAuthGrantIdentity = {
  grantId: string;
  clientId: string;
  userId: string;
  username: string;
  scope: string;
  resource: string;
  /** Epoch milliseconds. */
  expiresAt: number;
};

export async function verifyOAuthAccessToken(
  prisma: PrismaClient,
  token: string,
  now: number = Date.now()
): Promise<OAuthGrantIdentity | null> {
  if (!token.startsWith(ACCESS_PREFIX)) return null;
  const grant = await prisma.oAuthGrant.findUnique({
    where: { accessTokenHash: hash(token) },
    select: {
      id: true,
      clientId: true,
      scope: true,
      resource: true,
      accessExpiresAt: true,
      lastUsedAt: true,
      user: { select: { id: true, username: true, isConfigAdmin: true } },
    },
  });
  if (grant === null || grant.user.isConfigAdmin || grant.accessExpiresAt <= now) return null;
  if (grant.lastUsedAt === null || now - grant.lastUsedAt >= LAST_USED_WRITE_INTERVAL_MS) {
    // `updateMany`: the grant may be revoked between the read and this write.
    await prisma.oAuthGrant.updateMany({ where: { id: grant.id }, data: { lastUsedAt: now } });
  }
  return {
    grantId: grant.id,
    clientId: grant.clientId,
    userId: grant.user.id,
    username: grant.user.username,
    scope: grant.scope,
    resource: grant.resource,
    expiresAt: grant.accessExpiresAt,
  };
}

/**
 * RFC 7009 revocation by the client itself, with either of its tokens: ends
 * the whole grant. Scoped to the presenting client, and silent either way —
 * the RFC answers 200 for an unknown token too.
 */
export async function revokeOAuthToken(
  prisma: PrismaClient,
  args: { clientId: string; token: string }
): Promise<void> {
  const tokenHash = hash(args.token);
  await prisma.oAuthGrant.deleteMany({
    where: {
      clientId: args.clientId,
      OR: [{ accessTokenHash: tokenHash }, { refreshTokenHash: tokenHash }],
    },
  });
}

// ── For the reader ──────────────────────────────────────────────────────────────────

export type McpConnectionRow = {
  id: string;
  clientName: string;
  createdAt: number;
  lastUsedAt: number | null;
};

/**
 * The reader's connected agents, oldest first. Carries no token material, and
 * leaves out grants whose refresh token has lapsed: those agents are already
 * disconnected in every way that matters.
 */
export async function listMcpConnections(
  prisma: PrismaClient,
  userId: string,
  now: number = Date.now()
): Promise<McpConnectionRow[]> {
  const rows = await prisma.oAuthGrant.findMany({
    where: { userId, refreshExpiresAt: { gt: now } },
    select: { id: true, createdAt: true, lastUsedAt: true, client: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    id: row.id,
    clientName: row.client.name,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }));
}

/**
 * Disconnects one of the reader's agents. Owner-scoped in the WHERE clause, so
 * "not yours" and "no such connection" are the same `false`.
 */
export async function deleteMcpConnection(
  prisma: PrismaClient,
  args: { userId: string; id: string }
): Promise<boolean> {
  const { count } = await prisma.oAuthGrant.deleteMany({
    where: { id: args.id, userId: args.userId },
  });
  return count > 0;
}

/**
 * True while the grant a transfer ticket was minted under still exists for the
 * same reader — so disconnecting an agent also kills every upload/download URL
 * it was handed (`mcp/transfer-ticket.ts`).
 */
export async function oauthGrantIsLive(
  prisma: PrismaClient,
  args: { grantId: string; userId: string }
): Promise<boolean> {
  const row = await prisma.oAuthGrant.findFirst({
    where: { id: args.grantId, userId: args.userId },
    select: { id: true },
  });
  return row !== null;
}

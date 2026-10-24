/**
 * Persistence for the MCP authorization server: grants, single-use
 * authorization codes, and opaque access/refresh tokens.
 *
 * Every secret here is 32 random bytes, base64url, and only its SHA-256 hash
 * is stored — the same convention `services/token.ts` set for refresh tokens,
 * whose `hashToken` is reused rather than re-implemented. Tokens are
 * deliberately NOT JWTs: "Disconnect" in Settings deletes the grant, the
 * tokens cascade away with it, and the next request fails its lookup. A signed
 * token would outlive that until its expiry.
 *
 * Every time-based function takes `now` (ms since epoch) as an optional last
 * argument so tests can pin the clock without fake timers.
 */
import * as crypto from 'crypto';

import type { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';

import { hashToken } from '../services/token';

export const SCOPES = ['library:read', 'library:write'] as const;
export type McpScope = (typeof SCOPES)[number];

export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 10 * 60 * 1000;
/** A registered client no reader ever approved is forgotten after this long. */
export const UNGRANTED_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
/** `touchGrant` writes `lastUsedAt` at most this often. */
const LAST_USED_THROTTLE_MS = 60 * 1000;

const isScope = (value: string): value is McpScope => (SCOPES as readonly string[]).includes(value);

/**
 * The scopes a consent approval grants: the known subset of what the client
 * asked for, both when it asked for nothing, and `library:read` alone when
 * the reader flipped "Read only". Throws when the client asked only for
 * scopes this server does not have — there is nothing to grant.
 */
export function resolveGrantedScopes(
  requested: readonly string[] | undefined,
  readOnly: boolean
): McpScope[] {
  if (readOnly) return ['library:read'];
  const known = (requested ?? []).filter(isScope);
  if (requested === undefined || requested.length === 0) return [...SCOPES];
  const unique = [...new Set(known)];
  if (unique.length === 0) throw new RangeError('No supported scope was requested');
  return SCOPES.filter((scope) => unique.includes(scope));
}

export const parseScopes = (stored: string): McpScope[] =>
  stored.split(' ').filter((s): s is McpScope => isScope(s));

const newSecret = (): string => crypto.randomBytes(32).toString('base64url');

/**
 * One grant per (user, client). Re-approving the same client refreshes the
 * row's scopes and drops every token and code it previously held — a reader
 * who re-runs the connect flow has, in practice, lost the old tokens, and a
 * narrower re-approval must not leave a wider token alive.
 */
export async function upsertGrant(
  prisma: PrismaClient,
  input: { userId: string; clientId: string; scopes: readonly McpScope[] },
  now: number = Date.now()
): Promise<{ id: string }> {
  const scopes = input.scopes.join(' ');
  const grant = await prisma.mcpGrant.upsert({
    where: { userId_clientId: { userId: input.userId, clientId: input.clientId } },
    create: {
      id: nanoid(),
      userId: input.userId,
      clientId: input.clientId,
      scopes,
      createdAt: now,
    },
    update: { scopes },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.mcpToken.deleteMany({ where: { grantId: grant.id } }),
    prisma.mcpAuthorizationCode.deleteMany({ where: { grantId: grant.id } }),
    prisma.mcpClient.update({
      where: { clientId: input.clientId },
      data: { lastGrantedAt: now },
    }),
  ]);
  return grant;
}

export type CodeBinding = {
  grantId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string | null;
};

export async function createAuthorizationCode(
  prisma: PrismaClient,
  binding: CodeBinding,
  now: number = Date.now()
): Promise<string> {
  const code = newSecret();
  await prisma.mcpAuthorizationCode.create({
    data: {
      codeHash: hashToken(code),
      grantId: binding.grantId,
      redirectUri: binding.redirectUri,
      codeChallenge: binding.codeChallenge,
      resource: binding.resource,
      expiresAt: now + CODE_TTL_MS,
    },
  });
  return code;
}

/** Reads the PKCE challenge a live code was bound to, without consuming it. */
export async function peekAuthorizationCode(
  prisma: PrismaClient,
  code: string,
  now: number = Date.now()
): Promise<{ codeChallenge: string; clientId: string } | null> {
  const row = await prisma.mcpAuthorizationCode.findUnique({
    where: { codeHash: hashToken(code) },
    select: { codeChallenge: true, expiresAt: true, grant: { select: { clientId: true } } },
  });
  if (row === null || row.expiresAt <= now) return null;
  return { codeChallenge: row.codeChallenge, clientId: row.grant.clientId };
}

export type ConsumedCode = {
  grantId: string;
  clientId: string;
  userId: string;
  scopes: McpScope[];
  redirectUri: string;
  resource: string | null;
};

/**
 * Deletes and returns the code in one statement, so of two concurrent
 * exchanges exactly one wins — `consumeRefreshToken` in `services/token.ts`
 * is the precedent. The grant row is read afterwards; it cannot vanish
 * between the two reads except by a disconnect, which should fail the
 * exchange anyway.
 */
export async function consumeAuthorizationCode(
  prisma: PrismaClient,
  code: string,
  now: number = Date.now()
): Promise<ConsumedCode | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      grant_id: string;
      redirect_uri: string;
      resource: string | null;
      expires_at: number;
    }>
  >`DELETE FROM mcp_authorization_codes WHERE code_hash = ${hashToken(code)} RETURNING grant_id, redirect_uri, resource, expires_at`;
  const row = rows[0];
  if (!row || Number(row.expires_at) <= now) return null;
  const grant = await prisma.mcpGrant.findUnique({
    where: { id: row.grant_id },
    select: { clientId: true, userId: true, scopes: true },
  });
  if (grant === null) return null;
  return {
    grantId: row.grant_id,
    clientId: grant.clientId,
    userId: grant.userId,
    scopes: parseScopes(grant.scopes),
    redirectUri: row.redirect_uri,
    resource: row.resource,
  };
}

/** The token response body the SDK's token endpoint returns verbatim. */
export type IssuedTokens = {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export async function issueTokens(
  prisma: PrismaClient,
  grantId: string,
  scopes: readonly McpScope[],
  now: number = Date.now()
): Promise<IssuedTokens> {
  const access = newSecret();
  const refresh = newSecret();
  await prisma.mcpToken.createMany({
    data: [
      {
        tokenHash: hashToken(access),
        grantId,
        kind: 'access',
        expiresAt: now + ACCESS_TOKEN_TTL_MS,
        createdAt: now,
      },
      {
        tokenHash: hashToken(refresh),
        grantId,
        kind: 'refresh',
        expiresAt: now + REFRESH_TOKEN_TTL_MS,
        createdAt: now,
      },
    ],
  });
  return {
    access_token: access,
    token_type: 'bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refresh,
    scope: scopes.join(' '),
  };
}

/** Rotates: the presented refresh token is deleted as it is read. */
export async function consumeRefreshToken(
  prisma: PrismaClient,
  raw: string,
  now: number = Date.now()
): Promise<{ grantId: string; clientId: string; scopes: McpScope[] } | null> {
  const rows = await prisma.$queryRaw<
    Array<{ grant_id: string; expires_at: number }>
  >`DELETE FROM mcp_tokens WHERE token_hash = ${hashToken(raw)} AND kind = 'refresh' RETURNING grant_id, expires_at`;
  const row = rows[0];
  if (!row || Number(row.expires_at) <= now) return null;
  const grant = await prisma.mcpGrant.findUnique({
    where: { id: row.grant_id },
    select: { clientId: true, scopes: true },
  });
  if (grant === null) return null;
  return { grantId: row.grant_id, clientId: grant.clientId, scopes: parseScopes(grant.scopes) };
}

export type AccessTokenInfo = {
  grantId: string;
  clientId: string;
  userId: string;
  username: string;
  scopes: McpScope[];
  expiresAt: number;
};

/** Null when unknown, expired, revoked, or the user behind it is gone. */
export async function lookupAccessToken(
  prisma: PrismaClient,
  raw: string,
  now: number = Date.now()
): Promise<AccessTokenInfo | null> {
  const row = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: {
      kind: true,
      expiresAt: true,
      grant: {
        select: {
          id: true,
          clientId: true,
          scopes: true,
          user: { select: { id: true, username: true } },
        },
      },
    },
  });
  if (row === null || row.kind !== 'access' || row.expiresAt <= now) return null;
  return {
    grantId: row.grant.id,
    clientId: row.grant.clientId,
    userId: row.grant.user.id,
    username: row.grant.user.username,
    scopes: parseScopes(row.grant.scopes),
    expiresAt: row.expiresAt,
  };
}

export async function revokeToken(prisma: PrismaClient, raw: string): Promise<void> {
  await prisma.mcpToken.deleteMany({ where: { tokenHash: hashToken(raw) } });
}

/** Records use for the Settings list, without a write per tool call. */
export async function touchGrant(
  prisma: PrismaClient,
  grantId: string,
  now: number = Date.now()
): Promise<void> {
  await prisma.mcpGrant.updateMany({
    where: {
      id: grantId,
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: now - LAST_USED_THROTTLE_MS } }],
    },
    data: { lastUsedAt: now },
  });
}

/**
 * Runs on every token-endpoint call (sweep-on-write, like `deleteExpired`).
 * Grants are NOT swept: a grant with no live tokens is still something the
 * reader approved and can see in Settings. Clients are swept only while no
 * reader has ever approved them — see `McpClient.lastGrantedAt`.
 */
export async function sweepExpired(prisma: PrismaClient, now: number = Date.now()): Promise<void> {
  await prisma.$transaction([
    prisma.mcpToken.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.mcpAuthorizationCode.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.mcpClient.deleteMany({
      where: { lastGrantedAt: null, createdAt: { lt: now - UNGRANTED_CLIENT_TTL_MS } },
    }),
  ]);
}

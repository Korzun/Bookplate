/**
 * The reader-facing view of MCP grants: what Settings lists as "AI
 * assistants" and what Disconnect removes. Token mechanics live in
 * `mcp/tokens.ts`; this module only reads grants joined to their client's
 * registration document and deletes them.
 */
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { PrismaClient } from '@prisma/client';

import { parseScopes, type McpScope } from '../mcp/tokens';

export const UNNAMED_CLIENT = 'Unnamed client';

export type McpConnectionRow = {
  id: string;
  clientId: string;
  clientName: string;
  clientUri: string | null;
  logoUri: string | null;
  scopes: McpScope[];
  createdAt: number;
  lastUsedAt: number | null;
};

export type McpClientDisplay = {
  clientId: string;
  clientName: string;
  clientUri: string | null;
  logoUri: string | null;
};

const parseClient = (metadata: string): Partial<OAuthClientInformationFull> => {
  try {
    const parsed: unknown = JSON.parse(metadata);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Partial<OAuthClientInformationFull>)
      : {};
  } catch {
    return {};
  }
};

const display = (clientId: string, metadata: string): McpClientDisplay => {
  const client = parseClient(metadata);
  const name = typeof client.client_name === 'string' ? client.client_name.trim() : '';
  return {
    clientId,
    clientName: name === '' ? UNNAMED_CLIENT : name,
    clientUri: typeof client.client_uri === 'string' ? client.client_uri : null,
    logoUri: typeof client.logo_uri === 'string' ? client.logo_uri : null,
  };
};

export async function listMcpConnections(
  prisma: PrismaClient,
  userId: string
): Promise<McpConnectionRow[]> {
  const rows = await prisma.mcpGrant.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { client: { select: { metadata: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    ...display(row.clientId, row.client.metadata),
    scopes: parseScopes(row.scopes),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }));
}

/** Owner-scoped: another reader's grant id deletes nothing and returns false. */
export async function revokeMcpConnection(
  prisma: PrismaClient,
  input: { userId: string; id: string }
): Promise<boolean> {
  const result = await prisma.mcpGrant.deleteMany({
    where: { id: input.id, userId: input.userId },
  });
  return result.count > 0;
}

export async function getMcpClient(
  prisma: PrismaClient,
  clientId: string
): Promise<(McpClientDisplay & { redirectUris: string[] }) | null> {
  const row = await prisma.mcpClient.findUnique({ where: { clientId } });
  if (row === null) return null;
  const client = parseClient(row.metadata);
  return {
    ...display(clientId, row.metadata),
    redirectUris: Array.isArray(client.redirect_uris)
      ? client.redirect_uris.filter((uri): uri is string => typeof uri === 'string')
      : [],
  };
}

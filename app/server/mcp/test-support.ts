/**
 * Test-only wiring for the MCP server: a real Express app with the MCP
 * router, an SDK `Client` over Streamable HTTP against it, and a token
 * minted straight into the tables (so tool tests skip the browser consent
 * dance `oauth-provider.test.ts` already covers).
 */
import * as crypto from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { Harness } from '../graphql/test-util';
import { createServer } from '../server';
import { createMcpRouter } from './index';
import { issueTokens, upsertGrant, type McpScope } from './tokens';

export const TEST_BASE_URL = new URL('https://books.example');

export function buildMcpApp(harness: Harness) {
  const mcpRouter = createMcpRouter({
    baseUrl: TEST_BASE_URL,
    prisma: harness.prisma,
    config: harness.config,
    contextDeps: harness.contextDeps,
    thumbnails: harness.thumbnails,
    replaceStaging: harness.replaceStaging,
    editionsRoot: harness.editionsRoot,
  });
  return createServer({
    config: harness.config,
    thumbnailQueue: harness.thumbnails,
    jwtSecret: crypto.randomBytes(32),
    prisma: harness.prisma,
    graphqlHandler: (_req, res) => {
      res.status(404).end();
    },
    replaceStaging: harness.replaceStaging,
    mailer: null,
    mcpRouter,
  });
}

export async function mintToken(
  harness: Harness,
  userId: string,
  scopes: McpScope[] = ['library:read', 'library:write'],
  clientId = 'test-client'
): Promise<string> {
  await harness.prisma.mcpClient.upsert({
    where: { clientId },
    create: {
      clientId,
      clientIdIssuedAt: 1,
      metadata: JSON.stringify({
        client_id: clientId,
        client_name: 'Test Client',
        redirect_uris: ['https://c.example/cb'],
      }),
      createdAt: Date.now(),
    },
    update: {},
  });
  const grant = await upsertGrant(harness.prisma, { userId, clientId, scopes });
  return (await issueTokens(harness.prisma, grant.id, scopes)).access_token;
}

export type McpTestClient = {
  client: Client;
  /** `callTool` with the result narrowed to the shape every tool returns. */
  call: (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

export async function connectMcpClient(
  app: ReturnType<typeof createServer>,
  token: string
): Promise<McpTestClient> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'bookplate-test', version: '0.0.0' });
  try {
    await client.connect(transport);
  } catch (err) {
    server.close();
    throw err;
  }
  return {
    client,
    call: (name, args = {}) =>
      client.callTool({ name, arguments: args }) as Promise<CallToolResult>,
    close: async () => {
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export const textOf = (result: CallToolResult): string =>
  result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

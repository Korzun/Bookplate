/**
 * `POST /mcp` after the bearer middleware: turns the verified token into a
 * viewer, builds a one-shot server + stateless transport, and lets the SDK
 * answer the JSON-RPC body. Both are closed when the response ends, so a
 * client that drops the connection mid-call does not leave a server behind.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';

import { createContextForViewer } from '../graphql/context';
import type { McpRouterDeps } from './index';
import { buildMcpServer } from './server';
import { touchGrant } from './tokens';
import { isSetupComplete, viewerFromAuthInfo } from './viewer';

export const createMcpRequestHandler =
  (deps: McpRouterDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    const auth = req.auth;
    const viewer = auth === undefined ? null : await viewerFromAuthInfo(deps, auth);
    if (auth === undefined || viewer === null || viewer.userId === null) {
      res
        .status(401)
        .set(
          'WWW-Authenticate',
          'Bearer error="invalid_token", error_description="Unknown account"'
        )
        .json({ error: 'invalid_token', error_description: 'Unknown account' });
      return;
    }
    const grantId = auth.extra?.grantId;
    if (typeof grantId === 'string') await touchGrant(deps.prisma, grantId);

    const server = buildMcpServer({
      context: createContextForViewer(deps.contextDeps, viewer),
      viewer: { ...viewer, userId: viewer.userId },
      scopes: auth.scopes,
      prisma: deps.prisma,
      config: deps.config,
      replaceStaging: deps.replaceStaging,
      thumbnails: deps.thumbnails,
      editionsRoot: deps.editionsRoot,
      setupComplete: isSetupComplete(viewer),
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

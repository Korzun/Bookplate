/**
 * Everything the MCP feature mounts on the Express app, as one router that
 * `server.ts` installs at the root — or does not install at all when
 * `public_url` is missing or not https (`resolveMcpBaseUrl`).
 *
 * Owns: the four OAuth endpoints under `/mcp/oauth/*`, the two well-known
 * metadata documents, and `POST /mcp` itself. The MCP endpoint runs its own
 * `express.json({ limit: '8mb' })` because `server.ts` mounts this router
 * AHEAD of its global 100 kb parser (body-parser marks a parsed body and the
 * later parser skips it): a tool argument carrying a base64 EPUB needs the
 * headroom, and nothing else in the app does.
 */
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { PrismaClient } from '@prisma/client';
import express, { type NextFunction, type Request, type Response, Router } from 'express';

import type { ContextDeps } from '../graphql/context';
import type { ReplaceStaging } from '../services/replace-staging';
import type { ThumbnailQueue } from '../services/thumbnail-queue';
import type { AppConfig } from '../types';
import { resolveLoginClientIp } from '../utils/client-ip';
import { mcpEndpointUrl } from './base-url';
import { buildOAuthMetadata, OAUTH_PATHS } from './oauth-metadata';
import { createOAuthProvider } from './oauth-provider';
import { SCOPES } from './tokens';

export const MCP_BODY_LIMIT = '8mb';

export type McpRouterDeps = {
  baseUrl: URL;
  prisma: PrismaClient;
  config: AppConfig;
  contextDeps: ContextDeps;
  thumbnails: ThumbnailQueue;
  replaceStaging: ReplaceStaging;
  editionsRoot: string;
  /**
   * The authenticated MCP request handler. Supplied by `server.ts`'s
   * `handleMcpRequest` once the tool layer exists; the default answers 501
   * so the OAuth half can ship and be tested on its own.
   */
  handleMcp?: (req: Request, res: Response) => Promise<void>;
};

export type McpRequestHandler = NonNullable<McpRouterDeps['handleMcp']>;

export function createMcpRouter(deps: McpRouterDeps): Router {
  const { baseUrl, prisma, config } = deps;
  const provider = createOAuthProvider({ prisma, baseUrl });
  const metadata = buildOAuthMetadata(baseUrl);
  const resourceUrl = new URL(mcpEndpointUrl(baseUrl));

  // The SDK's limiters default to keying on `req.ip`, which behind the tunnel
  // or reverse proxy every MCP deployment sits behind is the proxy's address
  // — one bucket for everyone — and logs a validation error about the
  // `X-Forwarded-For` it then sees. Key on the same proxy-aware resolver the
  // login limiter uses; the windows and counts stay the SDK's.
  const rateLimit = {
    keyGenerator: (req: Request) => resolveLoginClientIp(req, config.trustProxyHops ?? 0),
    validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  };

  const router = Router();

  router.use(OAUTH_PATHS.authorize, authorizationHandler({ provider, rateLimit }));
  router.use(OAUTH_PATHS.token, tokenHandler({ provider, rateLimit }));
  router.use(
    OAUTH_PATHS.register,
    clientRegistrationHandler({
      clientsStore: provider.clientsStore,
      // Never expire: an assistant whose secret lapsed would silently stop
      // working after 30 days with no UI anywhere to re-register it.
      clientSecretExpirySeconds: 0,
      rateLimit,
    })
  );
  router.use(OAUTH_PATHS.revoke, revocationHandler({ provider, rateLimit }));
  router.use(
    mcpAuthMetadataRouter({
      oauthMetadata: metadata,
      resourceServerUrl: resourceUrl,
      scopesSupported: [...SCOPES],
      resourceName: config.libraryName,
    })
  );

  const handleMcp: McpRequestHandler =
    deps.handleMcp ??
    (async (_req, res) => {
      res.status(501).json({ error: 'MCP tools are not available yet' });
    });

  const bodyLimitErrors = (
    err: unknown,
    _req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { type?: string }).type === 'entity.too.large'
    ) {
      res.status(413).json({ error: 'Request body too large' });
      return;
    }
    next(err);
  };

  router.post(
    '/mcp',
    express.json({ limit: MCP_BODY_LIMIT }),
    bodyLimitErrors,
    requireBearerAuth({
      verifier: provider,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
    }),
    (req: Request, res: Response, next: NextFunction) => {
      handleMcp(req, res).catch(next);
    }
  );
  // Stateless transport: there is no server→client stream to open and no
  // session to delete. Answer as the SDK does in this mode rather than letting
  // the SPA catch-all serve index.html to an MCP client.
  router.all('/mcp', (_req, res) => {
    res.set('Allow', 'POST').status(405).json({ error: 'Method not allowed' });
  });

  return router;
}

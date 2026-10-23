/**
 * OAuth 2.1 for the MCP endpoint, as the MCP authorization spec lays it out:
 *
 *  - `GET /.well-known/oauth-protected-resource/mcp` (RFC 9728) — where an
 *    agent that got a 401 from `/mcp` learns which authorization server to use;
 *  - `GET /.well-known/oauth-authorization-server` (RFC 8414) — that server's
 *    endpoints;
 *  - `/oauth/register` (RFC 7591 dynamic client registration), `/oauth/authorize`,
 *    `/oauth/token` and `/oauth/revoke` (RFC 7009) — the MCP SDK's own handlers
 *    over `mcp/oauth-provider.ts`;
 *  - `GET`/`POST /api/oauth/consent` — the web app's consent page asking what it
 *    is approving, and answering. Signed-in web session only.
 *
 * The metadata is built per request from `publicOrigin` rather than once at
 * boot, so it always names the address the agent actually used; see that
 * function for the rule, and `mcp/oauth-provider.ts` for why the SDK's
 * all-in-one router does not fit.
 *
 * Mounted ahead of `express.json()` in `server.ts`, like `/mcp`: the SDK's
 * handlers parse their own bodies.
 */
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { PrismaClient } from '@prisma/client';
import express, { Router, type Request, type RequestHandler, type Response } from 'express';

import { logger } from '../logger';
import type { AuthorizationCodes } from '../mcp/authorization-codes';
import { verifyConsentRequest } from '../mcp/consent-request';
import { emailSetupGate, jwtAuth, passwordChangeGate } from '../middleware/auth';
import { getOAuthClient, MCP_SCOPE } from '../services/mcp-oauth';
import type { AppConfig } from '../types';
import { asyncHandler } from '../utils/async-handler';
import { mcpResourceUrl, publicOrigin } from '../utils/public-origin';

const log = logger('MCP');

export const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';

/** Where `/mcp`'s 401 points an agent (RFC 9728 §5.1). */
export const protectedResourceMetadataUrl = (origin: string): string =>
  `${origin}${PROTECTED_RESOURCE_METADATA_PATH}`;

/**
 * The SDK handlers' built-in per-IP limits stay on. Its `X-Forwarded-For`
 * check is off: this server never sets Express's `trust proxy` (see
 * `routes/ui.ts`'s `resolveLoginClientIp` for why), so behind a proxy the
 * check would only log a warning about a header it is right to ignore.
 */
const RATE_LIMIT = { validate: { xForwardedForHeader: false } };

/** Discovery documents are public and read cross-origin by browser-based clients. */
const publicJson =
  (build: (req: Request) => Record<string, unknown>): RequestHandler =>
  (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'no-store');
    res.json(build(req));
  };

export type CreateMcpOAuthRouterDeps = {
  prisma: PrismaClient;
  config: AppConfig;
  jwtSecret: Buffer;
  provider: OAuthServerProvider;
  codes: AuthorizationCodes;
};

export function createMcpOAuthRouter({
  prisma,
  config,
  jwtSecret,
  provider,
  codes,
}: CreateMcpOAuthRouterDeps): Router {
  const router = Router();
  const origin = (req: Request) => publicOrigin(req, config.publicUrl);

  // ── Discovery ──

  const protectedResource = publicJson((req) => ({
    resource: mcpResourceUrl(origin(req)),
    authorization_servers: [origin(req)],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: config.libraryName,
  }));
  // The path-specific form is the one RFC 9728 and `/mcp`'s 401 name; the bare
  // form is what clients fall back to.
  router.get(PROTECTED_RESOURCE_METADATA_PATH, protectedResource);
  router.get('/.well-known/oauth-protected-resource', protectedResource);

  router.get(
    '/.well-known/oauth-authorization-server',
    publicJson((req) => {
      const issuer = origin(req);
      return {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        // The SDK's client authentication reads a secret from the body only.
        token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
        revocation_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
        scopes_supported: [MCP_SCOPE],
      };
    })
  );
  router.options(
    ['/.well-known/oauth-protected-resource*', '/.well-known/oauth-authorization-server'],
    (_req, res) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET');
      res.status(204).end();
    }
  );

  // ── The SDK's protocol handlers ──

  router.use('/oauth/authorize', authorizationHandler({ provider, rateLimit: RATE_LIMIT }));
  router.use('/oauth/token', tokenHandler({ provider, rateLimit: RATE_LIMIT }));
  router.use(
    '/oauth/register',
    clientRegistrationHandler({
      clientsStore: provider.clientsStore,
      // A confidential client's secret never expires on its own: an expired
      // one would silently break that agent's refreshes a month in. Revoking
      // access is the reader's job, on the settings page.
      clientSecretExpirySeconds: 0,
      rateLimit: RATE_LIMIT,
    })
  );
  router.use('/oauth/revoke', revocationHandler({ provider, rateLimit: RATE_LIMIT }));

  // ── Consent (the web app) ──

  /**
   * The route-level gates are the same two the web API runs behind
   * (`routes/ui.ts`): a reader with a forced password change or a missing
   * email address must finish that first. Attached per route, not with
   * `router.use('/api/oauth', …)`, because both gates key on `req.path`
   * starting with `/api/`, which a prefix mount would strip.
   */
  const consentAuth = [
    passwordChangeGate(jwtSecret),
    emailSetupGate(jwtSecret),
    jwtAuth(jwtSecret),
  ];

  /**
   * Resolves the request the consent page carries, for a reader. Responds and
   * returns `null` otherwise: an expired/forged request, a client deleted
   * since, or the config admin (which owns no library to connect).
   */
  async function resolveConsent(req: Request, res: Response, raw: unknown) {
    if (req.user!.userId === undefined || req.user!.isAdmin) {
      res.status(403).json({
        error: 'The admin account has no library to connect. Sign in as a reader instead.',
      });
      return null;
    }
    const request = typeof raw === 'string' ? verifyConsentRequest(jwtSecret, raw) : null;
    const client = request === null ? undefined : await getOAuthClient(prisma, request.clientId);
    if (request === null || client === undefined) {
      res.status(400).json({
        error: 'This sign-in request has expired or is invalid. Start again from your agent.',
      });
      return null;
    }
    return { request, client, userId: req.user!.userId };
  }

  router.get(
    '/api/oauth/consent',
    ...consentAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const resolved = await resolveConsent(req, res, req.query.request);
      if (resolved === null) return;
      const { request, client } = resolved;
      res.json({
        clientName: client.client_name?.trim() || new URL(request.redirectUri).host,
        clientUri: client.client_uri ?? null,
        redirectHost: new URL(request.redirectUri).host,
        username: req.user!.username,
        libraryName: config.libraryName,
      });
    })
  );

  router.post(
    '/api/oauth/consent',
    express.json(),
    ...consentAuth,
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as { request?: unknown; approve?: unknown };
      const resolved = await resolveConsent(req, res, body.request);
      if (resolved === null) return;
      const { request, client, userId } = resolved;

      const redirect = new URL(request.redirectUri);
      if (body.approve === true) {
        const code = codes.issue({
          clientId: request.clientId,
          userId,
          redirectUri: request.redirectUri,
          redirectUriExplicit: request.redirectUriExplicit,
          codeChallenge: request.codeChallenge,
          resource: request.resource,
        });
        redirect.searchParams.set('code', code);
        log.info(
          `Reader "${req.user!.username}" connected agent "${client.client_name ?? client.client_id}"`
        );
      } else {
        redirect.searchParams.set('error', 'access_denied');
        redirect.searchParams.set('error_description', 'The reader declined access.');
      }
      if (request.state !== null) redirect.searchParams.set('state', request.state);
      res.json({ redirectTo: redirect.href });
    })
  );

  return router;
}

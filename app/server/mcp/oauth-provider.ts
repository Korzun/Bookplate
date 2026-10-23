/**
 * Bookplate as an OAuth 2.1 authorization server for its own MCP endpoint.
 *
 * The MCP SDK's handlers (`authorizationHandler`, `tokenHandler`,
 * `clientRegistrationHandler`, `revocationHandler`) speak the protocol: request
 * validation, PKCE (S256) verification, client authentication, RFC 6749 error
 * responses, and RFC 8252's any-port rule for loopback redirect URIs. This
 * provider is the part they delegate: storage (`services/mcp-oauth.ts`), the
 * in-memory codes (`mcp/authorization-codes.ts`), and the one step that
 * involves the reader — consent, which happens in the web app.
 *
 * `authorize` does not decide anything. It hands the validated request to the
 * consent page (`/oauth/consent`), behind the web app's ordinary sign-in, and
 * the reader's answer comes back through `routes/mcp-oauth.ts`'s consent API,
 * which issues the code. So an agent reaches a library only after its owner
 * has signed in to Bookplate and said yes.
 *
 * Not the SDK's `mcpAuthRouter`: that builds its metadata once, from one fixed
 * HTTPS issuer, whereas this add-on's address is often known only per request
 * and is frequently plain HTTP on a LAN. `routes/mcp-oauth.ts` serves the
 * metadata per request instead and mounts the handlers individually.
 */
import type { IncomingMessage } from 'http';

import {
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { PrismaClient } from '@prisma/client';
import type { Response } from 'express';

import {
  createOAuthGrant,
  getOAuthClient,
  refreshOAuthGrant,
  registerOAuthClient,
  revokeOAuthToken,
  verifyOAuthAccessToken,
  type OAuthGrantIdentity,
} from '../services/mcp-oauth';
import { mcpResourceUrl, publicOrigin } from '../utils/public-origin';
import type { AuthorizationCodes } from './authorization-codes';
import { signConsentRequest } from './consent-request';

/** The web app's consent page (a client route, served by the SPA catch-all). */
export const CONSENT_PATH = '/oauth/consent';

export type McpOAuthProviderDeps = {
  prisma: PrismaClient;
  jwtSecret: Buffer;
  publicUrl: string | null | undefined;
  codes: AuthorizationCodes;
};

/**
 * Whether `requested` names this server's MCP endpoint. Uses the SDK's own
 * RFC 8707 matcher, the same one its client applies to our metadata.
 */
const isOurResource = (requested: string, ours: string): boolean => {
  try {
    return checkResourceAllowed({ requestedResource: requested, configuredResource: ours });
  } catch {
    return false;
  }
};

export function createMcpOAuthProvider(deps: McpOAuthProviderDeps): OAuthServerProvider & {
  verifyGrant: (token: string) => Promise<OAuthGrantIdentity | null>;
} {
  const { prisma, jwtSecret, publicUrl, codes } = deps;

  return {
    clientsStore: {
      getClient: (clientId) => getOAuthClient(prisma, clientId),
      registerClient: (client) => registerOAuthClient(prisma, client),
    },

    async authorize(
      client: OAuthClientInformationFull,
      params: AuthorizationParams,
      res: Response
    ): Promise<void> {
      const req = res.req as IncomingMessage & {
        query?: Record<string, unknown>;
        body?: Record<string, unknown>;
      };
      const ours = mcpResourceUrl(publicOrigin(req, publicUrl));
      // RFC 8707: a token is only ever for this server's MCP endpoint. A
      // client that names something else is told so (the handler turns this
      // into an `invalid_target` redirect) rather than handed a token for it.
      if (params.resource !== undefined && !isOurResource(params.resource.href, ours)) {
        throw new InvalidTargetError(`This server only issues tokens for ${ours}`);
      }
      const named = req.method === 'POST' ? req.body?.redirect_uri : req.query?.redirect_uri;
      const ticket = signConsentRequest(jwtSecret, {
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        redirectUriExplicit: typeof named === 'string',
        codeChallenge: params.codeChallenge,
        state: params.state ?? null,
        resource: ours,
      });
      res.redirect(302, `${CONSENT_PATH}?request=${encodeURIComponent(ticket)}`);
    },

    async challengeForAuthorizationCode(client, authorizationCode) {
      const request = codes.peek(authorizationCode);
      if (request === null || request.clientId !== client.client_id) {
        throw new InvalidGrantError('Invalid or expired authorization code');
      }
      return request.codeChallenge;
    },

    async exchangeAuthorizationCode(
      client,
      authorizationCode,
      _codeVerifier,
      redirectUri,
      resource
    ) {
      // PKCE was verified by the SDK's token handler before this runs.
      const request = codes.consume(authorizationCode);
      if (request === null || request.clientId !== client.client_id) {
        throw new InvalidGrantError('Invalid or expired authorization code');
      }
      // RFC 6749 §4.1.3: a redirect_uri named at /authorize must be repeated here.
      if (
        (redirectUri !== undefined && redirectUri !== request.redirectUri) ||
        (redirectUri === undefined && request.redirectUriExplicit)
      ) {
        throw new InvalidGrantError('redirect_uri does not match the authorization request');
      }
      if (resource !== undefined && !isOurResource(resource.href, request.resource)) {
        throw new InvalidTargetError('resource does not match the authorization request');
      }
      return createOAuthGrant(prisma, {
        userId: request.userId,
        clientId: client.client_id,
        resource: request.resource,
      });
    },

    async exchangeRefreshToken(client, refreshToken) {
      // Every grant has the one scope and the one resource, so a narrower
      // request has nothing to narrow — both arguments are ignored.
      const tokens = await refreshOAuthGrant(prisma, { clientId: client.client_id, refreshToken });
      if (tokens === null) throw new InvalidGrantError('Invalid or expired refresh token');
      return tokens;
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      const identity = await verifyOAuthAccessToken(prisma, token);
      if (identity === null) throw new InvalidTokenError('Invalid or expired access token');
      return {
        token,
        clientId: identity.clientId,
        scopes: identity.scope.split(' '),
        expiresAt: Math.floor(identity.expiresAt / 1000),
        resource: new URL(identity.resource),
        extra: { grantId: identity.grantId, userId: identity.userId },
      };
    },

    /** For `/mcp` itself, which needs the reader, not just `AuthInfo`. */
    verifyGrant: (token) => verifyOAuthAccessToken(prisma, token),

    async revokeToken(client, request) {
      await revokeOAuthToken(prisma, { clientId: client.client_id, token: request.token });
    },
  };
}

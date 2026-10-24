/**
 * The RFC 8414 authorization-server metadata document, built by hand rather
 * than with the SDK's `createOAuthMetadata`: that helper hard-codes
 * `/authorize`, `/token`, `/register` and `/revoke` at the site root, and the
 * root belongs to the SPA. Everything else matches what the SDK would emit for
 * a provider that supports registration and revocation.
 */
import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';

import { SCOPES } from './tokens';

export const OAUTH_PATHS = {
  authorize: '/mcp/oauth/authorize',
  token: '/mcp/oauth/token',
  register: '/mcp/oauth/register',
  revoke: '/mcp/oauth/revoke',
} as const;

export function buildOAuthMetadata(baseUrl: URL): OAuthMetadata {
  const at = (pathname: string): string => new URL(pathname, baseUrl).href;
  return {
    issuer: baseUrl.href,
    authorization_endpoint: at(OAUTH_PATHS.authorize),
    token_endpoint: at(OAUTH_PATHS.token),
    registration_endpoint: at(OAUTH_PATHS.register),
    revocation_endpoint: at(OAUTH_PATHS.revoke),
    scopes_supported: [...SCOPES],
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    revocation_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
  };
}

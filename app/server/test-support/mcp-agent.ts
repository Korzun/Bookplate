/**
 * A real Bookplate MCP stack on an ephemeral port, and a real MCP agent that
 * connects to it the way Claude or Cursor does — through the MCP SDK client's
 * own OAuth: discovery from the 401, dynamic client registration, PKCE, code
 * exchange. The one step a person performs, approving on the consent page, is
 * done here against the real consent API as a signed-in reader.
 *
 * Shared by `routes/mcp.test.ts` (the tools) and `routes/mcp-oauth.test.ts`
 * (the protocol).
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import express from 'express';

import type { Viewer } from '../graphql/context';
import type { Harness } from '../graphql/test-util';
import { createAuthorizationCodes, type AuthorizationCodes } from '../mcp/authorization-codes';
import { createMcpOAuthProvider } from '../mcp/oauth-provider';
import { createMcpRouter } from '../routes/mcp';
import { createMcpOAuthRouter } from '../routes/mcp-oauth';
import { signAccessToken } from '../services/jwt';

export type McpTestServer = {
  baseUrl: string;
  codes: AuthorizationCodes;
  /** A web-session access token for `viewer`, as the browser would hold after signing in. */
  webToken: (viewer: Viewer) => string;
  close: () => Promise<void>;
};

export async function startMcpTestServer(
  harness: Harness,
  options: { publicUrl?: string } = {}
): Promise<McpTestServer> {
  const contextDeps = harness.contextDeps();
  const { prisma, jwtSecret } = contextDeps;
  const config = { ...harness.config, publicUrl: options.publicUrl ?? null };
  const codes = createAuthorizationCodes();
  const provider = createMcpOAuthProvider({
    prisma,
    jwtSecret,
    publicUrl: config.publicUrl,
    codes,
  });
  const app = express();
  app.use(createMcpOAuthRouter({ prisma, config, jwtSecret, provider, codes }));
  app.use(
    '/mcp',
    createMcpRouter({
      contextDeps: { ...contextDeps, config },
      verifyAccessToken: provider.verifyGrant,
    })
  );
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    codes,
    webToken: (viewer) =>
      signAccessToken(jwtSecret, {
        ...(viewer.userId !== null ? { userId: viewer.userId } : {}),
        username: viewer.username,
        isAdmin: viewer.isAdmin,
        mustChangePassword: viewer.mustChangePassword,
        mustSetEmail: viewer.mustSetEmail,
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Follows `/oauth/authorize` to the consent page and answers it as the reader
 * holding `webToken` — what a person does in their browser. Returns the URL
 * the browser would then be sent to (the agent's redirect URI, with a code or
 * an error).
 */
export async function answerConsent(
  baseUrl: string,
  authorizationUrl: URL | string,
  webToken: string,
  approve = true
): Promise<URL> {
  const authorize = await fetch(authorizationUrl, { redirect: 'manual' });
  if (authorize.status !== 302) {
    throw new Error(`authorize answered ${authorize.status}: ${await authorize.text()}`);
  }
  const consentPage = new URL(authorize.headers.get('location')!, baseUrl);
  if (consentPage.pathname !== '/oauth/consent') {
    throw new Error(`authorize redirected to ${consentPage.href}, not the consent page`);
  }
  const res = await fetch(`${baseUrl}/api/oauth/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${webToken}` },
    body: JSON.stringify({ request: consentPage.searchParams.get('request'), approve }),
  });
  if (!res.ok) throw new Error(`consent answered ${res.status}: ${await res.text()}`);
  return new URL(((await res.json()) as { redirectTo: string }).redirectTo);
}

export const AGENT_REDIRECT_URI = 'http://localhost:7777/callback';

/** An in-memory `OAuthClientProvider`, the role an MCP client app plays. */
export class TestAgentAuth implements OAuthClientProvider {
  private info: OAuthClientInformationMixed | undefined;
  private stored: OAuthTokens | undefined;
  private verifier = '';
  authorizationUrl: URL | undefined;

  constructor(private readonly name = 'Test Agent') {}

  get redirectUrl(): string {
    return AGENT_REDIRECT_URI;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.name,
      redirect_uris: [AGENT_REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.info = info;
  }
  tokens() {
    return this.stored;
  }
  saveTokens(tokens: OAuthTokens) {
    this.stored = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
}

/**
 * Connects an MCP client the way an agent app does the first time: the
 * connect fails with 401, the SDK runs discovery + registration and "opens
 * the browser" at the authorization URL; the reader approves; the app
 * finishes with the code and connects again.
 */
export async function connectAgent(
  server: McpTestServer,
  viewer: Viewer,
  auth: TestAgentAuth = new TestAgentAuth()
): Promise<{ client: Client; auth: TestAgentAuth }> {
  const transport = () =>
    new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`), { authProvider: auth });
  const first = transport();
  try {
    await new Client({ name: 'bookplate-test', version: '0.0.0' }).connect(first);
  } catch (err) {
    if (!(err instanceof UnauthorizedError) || auth.authorizationUrl === undefined) throw err;
    const callback = await answerConsent(
      server.baseUrl,
      auth.authorizationUrl,
      server.webToken(viewer)
    );
    await first.finishAuth(callback.searchParams.get('code')!);
  }
  const client = new Client({ name: 'bookplate-test', version: '0.0.0' });
  await client.connect(transport());
  return { client, auth };
}

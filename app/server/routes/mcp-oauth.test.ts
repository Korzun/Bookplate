import { createHash, randomBytes } from 'crypto';

import { createHarness, type Harness } from '../graphql/test-util';
import {
  AGENT_REDIRECT_URI,
  answerConsent,
  startMcpTestServer,
  type McpTestServer,
} from '../test-support/mcp-agent';

vi.mock('../logger');

let harness: Harness;
let server: McpTestServer;
let base: string;

beforeEach(async () => {
  harness = await createHarness();
  server = await startMcpTestServer(harness);
  base = server.baseUrl;
});

afterEach(async () => {
  await server.close();
  await harness.cleanup();
});

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

async function register(name = 'Hand-rolled Agent'): Promise<string> {
  const res = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [AGENT_REDIRECT_URI],
      token_endpoint_auth_method: 'none',
    }),
  });
  expect(res.status).toBe(201);
  return (await json(res)).client_id as string;
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function authorizeUrl(
  clientId: string,
  challenge: string,
  extra: Record<string, string> = {}
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: AGENT_REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: `${base}/mcp`,
    ...extra,
  });
  return `${base}/oauth/authorize?${params}`;
}

const token = (body: Record<string, string>) =>
  fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

/** Registers, approves as alice, and redeems the code: a connected agent's tokens. */
async function connect() {
  const clientId = await register();
  const { verifier, challenge } = pkce();
  const callback = await answerConsent(
    base,
    authorizeUrl(clientId, challenge),
    server.webToken(harness.aliceViewer)
  );
  const res = await token({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: callback.searchParams.get('code')!,
    code_verifier: verifier,
    redirect_uri: AGENT_REDIRECT_URI,
  });
  expect(res.status).toBe(200);
  const tokens = await json(res);
  return {
    clientId,
    accessToken: tokens.access_token as string,
    refreshToken: tokens.refresh_token as string,
    tokens,
  };
}

const callMcp = (accessToken: string) =>
  fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    }),
  });

describe('discovery', () => {
  it('describes the MCP endpoint and its authorization server at the address used', async () => {
    const resource = await json(await fetch(`${base}/.well-known/oauth-protected-resource/mcp`));
    expect(resource).toMatchObject({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: ['library'],
    });

    const metadata = await json(await fetch(`${base}/.well-known/oauth-authorization-server`));
    expect(metadata).toMatchObject({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
    });
  });

  it('advertises https behind a TLS-terminating proxy', async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`, {
      headers: { 'X-Forwarded-Proto': 'https' },
    });
    expect((await json(res)).resource).toBe(`${base.replace('http:', 'https:')}/mcp`);
  });

  it('uses public_url when the operator set one', async () => {
    await server.close();
    server = await startMcpTestServer(harness, { publicUrl: 'https://books.example.com' });
    base = server.baseUrl;
    const metadata = await json(await fetch(`${base}/.well-known/oauth-authorization-server`));
    expect(metadata.issuer).toBe('https://books.example.com');
  });
});

describe('consent', () => {
  async function consentRequest(): Promise<string> {
    const clientId = await register('Claude');
    const res = await fetch(authorizeUrl(clientId, pkce().challenge), { redirect: 'manual' });
    expect(res.status).toBe(302);
    return new URL(res.headers.get('location')!, base).searchParams.get('request')!;
  }

  const consent = (request: string, webToken: string, method: 'GET' | 'POST' = 'GET') =>
    method === 'GET'
      ? fetch(`${base}/api/oauth/consent?request=${encodeURIComponent(request)}`, {
          headers: { Authorization: `Bearer ${webToken}` },
        })
      : fetch(`${base}/api/oauth/consent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${webToken}` },
          body: JSON.stringify({ request, approve: true }),
        });

  it('tells the reader who is asking and where it will be sent', async () => {
    const res = await consent(await consentRequest(), server.webToken(harness.aliceViewer));
    expect(await json(res)).toMatchObject({
      clientName: 'Claude',
      redirectHost: 'localhost:7777',
      username: 'alice',
    });
  });

  it('sends a declined request back to the agent with access_denied, and grants nothing', async () => {
    const clientId = await register();
    const callback = await answerConsent(
      base,
      authorizeUrl(clientId, pkce().challenge),
      server.webToken(harness.aliceViewer),
      false
    );
    expect(callback.origin + callback.pathname).toBe(AGENT_REDIRECT_URI);
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('state')).toBe('xyz');
    expect(callback.searchParams.has('code')).toBe(false);
    expect(await harness.prisma.oAuthGrant.count()).toBe(0);
  });

  it('refuses the config admin, which owns no library', async () => {
    const request = await consentRequest();
    for (const method of ['GET', 'POST'] as const) {
      const res = await consent(request, server.webToken(harness.adminViewer), method);
      expect(res.status).toBe(403);
    }
  });

  it('refuses a reader who still owes a password change, as the rest of the web API does', async () => {
    const res = await consent(
      await consentRequest(),
      server.webToken({ ...harness.aliceViewer, mustChangePassword: true }),
      'POST'
    );
    expect(res.status).toBe(403);
  });

  it('refuses without a web session, and a forged request', async () => {
    const request = await consentRequest();
    expect((await fetch(`${base}/api/oauth/consent?request=${request}`)).status).toBe(401);
    const forged = await consent(`${request}x`, server.webToken(harness.aliceViewer), 'POST');
    expect(forged.status).toBe(400);
  });
});

describe('authorization', () => {
  it('refuses a token for some other resource', async () => {
    const clientId = await register();
    const res = await fetch(
      authorizeUrl(clientId, pkce().challenge, { resource: 'https://elsewhere.example/mcp' }),
      { redirect: 'manual' }
    );
    expect(res.status).toBe(302);
    const callback = new URL(res.headers.get('location')!);
    expect(callback.searchParams.get('error')).toBe('invalid_target');
  });

  it('refuses a redirect URI the client did not register', async () => {
    const clientId = await register();
    const res = await fetch(
      authorizeUrl(clientId, pkce().challenge, { redirect_uri: 'https://evil.example/cb' }),
      { redirect: 'manual' }
    );
    expect(res.status).toBe(400);
  });
});

describe('tokens', () => {
  it('issues tokens that work at /mcp and shows the agent as connected', async () => {
    const { accessToken, tokens } = await connect();
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'library' });
    expect((await callMcp(accessToken)).status).toBe(200);

    const listed = await harness.execute(
      `{ viewer { mcpConnections { clientName lastUsedAt } } }`,
      { viewer: harness.aliceViewer }
    );
    expect(listed.data).toEqual({
      viewer: {
        mcpConnections: [{ clientName: 'Hand-rolled Agent', lastUsedAt: expect.any(String) }],
      },
    });
  });

  it('refuses a code with the wrong PKCE verifier, and a code used twice', async () => {
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const callback = await answerConsent(
      base,
      authorizeUrl(clientId, challenge),
      server.webToken(harness.aliceViewer)
    );
    const code = callback.searchParams.get('code')!;
    const exchange = (codeVerifier: string) =>
      token({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: codeVerifier,
        redirect_uri: AGENT_REDIRECT_URI,
      });

    const wrong = await exchange(pkce().verifier);
    expect(wrong.status).toBe(400);
    expect((await json(wrong)).error).toBe('invalid_grant');

    expect((await exchange(verifier)).status).toBe(200);
    const reused = await exchange(verifier);
    expect(reused.status).toBe(400);
    expect((await json(reused)).error).toBe('invalid_grant');
  });

  it("refuses a code redeemed by a client it wasn't issued to", async () => {
    const clientId = await register();
    const other = await register('Other');
    const { verifier, challenge } = pkce();
    const callback = await answerConsent(
      base,
      authorizeUrl(clientId, challenge),
      server.webToken(harness.aliceViewer)
    );
    const res = await token({
      grant_type: 'authorization_code',
      client_id: other,
      code: callback.searchParams.get('code')!,
      code_verifier: verifier,
      redirect_uri: AGENT_REDIRECT_URI,
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('invalid_grant');
  });

  it('requires the redirect_uri named at /authorize to be repeated (RFC 6749 §4.1.3)', async () => {
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const callback = await answerConsent(
      base,
      authorizeUrl(clientId, challenge),
      server.webToken(harness.aliceViewer)
    );
    const res = await token({
      grant_type: 'authorization_code',
      client_id: clientId,
      code: callback.searchParams.get('code')!,
      code_verifier: verifier,
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('invalid_grant');
  });

  it('rotates both tokens on refresh, retiring the old ones', async () => {
    const { clientId, accessToken, refreshToken } = await connect();

    const res = await token({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    });
    expect(res.status).toBe(200);
    const fresh = await json(res);
    expect(fresh.refresh_token).not.toBe(refreshToken);

    expect((await callMcp(fresh.access_token as string)).status).toBe(200);
    expect((await callMcp(accessToken)).status).toBe(401);
    const replay = await token({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    });
    expect(replay.status).toBe(400);
    expect((await json(replay)).error).toBe('invalid_grant');
  });

  it('lets the agent revoke its own grant', async () => {
    const { clientId, accessToken } = await connect();
    const res = await fetch(`${base}/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, token: accessToken }),
    });
    expect(res.status).toBe(200);
    expect((await callMcp(accessToken)).status).toBe(401);
    expect(await harness.prisma.oAuthGrant.count()).toBe(0);
  });

  it('disconnects from the settings page through GraphQL, for the owner only', async () => {
    const { accessToken } = await connect();
    const [{ id }] = await harness.prisma.oAuthGrant.findMany({ select: { id: true } });
    const mutation = `mutation($id: ID!) { viewerDisconnectMcpConnection(id: $id) }`;

    const asBob = await harness.execute(mutation, { viewer: harness.bobViewer, variables: { id } });
    expect(asBob.data).toEqual({ viewerDisconnectMcpConnection: false });
    expect((await callMcp(accessToken)).status).toBe(200);

    const asAlice = await harness.execute(mutation, { variables: { id } });
    expect(asAlice.data).toEqual({ viewerDisconnectMcpConnection: true });
    expect((await callMcp(accessToken)).status).toBe(401);
  });
});

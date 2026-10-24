import { createHash, randomBytes } from 'crypto';

import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import express from 'express';
import request from 'supertest';

import { createHarness, type Harness } from '../graphql/test-util';
import { deleteUser } from '../services/user';
import { createOAuthProvider } from './oauth-provider';
import { createAuthorizationCode, issueTokens, upsertGrant } from './tokens';

vi.mock('../logger');

const BASE = new URL('https://books.example');
const REDIRECT = 'https://client.example/callback';

let harness: Harness;
let app: express.Express;
let provider: ReturnType<typeof createOAuthProvider>;

beforeEach(async () => {
  harness = await createHarness();
  provider = createOAuthProvider({ prisma: harness.prisma, baseUrl: BASE });
  app = express();
  app.use('/mcp/oauth/authorize', authorizationHandler({ provider, rateLimit: false }));
  app.use('/mcp/oauth/token', tokenHandler({ provider, rateLimit: false }));
  app.use(
    '/mcp/oauth/register',
    clientRegistrationHandler({
      clientsStore: provider.clientsStore,
      clientSecretExpirySeconds: 0,
      rateLimit: false,
    })
  );
  app.use('/mcp/oauth/revoke', revocationHandler({ provider, rateLimit: false }));
});

afterEach(async () => {
  await harness.cleanup();
});

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

const register = async (): Promise<{ client_id: string; client_secret?: string }> => {
  const res = await request(app)
    .post('/mcp/oauth/register')
    .send({ redirect_uris: [REDIRECT], client_name: 'Claude', token_endpoint_auth_method: 'none' });
  expect(res.status).toBe(201);
  return res.body as { client_id: string; client_secret?: string };
};

const mintCode = async (
  clientId: string,
  challenge: string,
  opts: { scopes?: ('library:read' | 'library:write')[]; userId?: string } = {}
) => {
  const grant = await upsertGrant(harness.prisma, {
    userId: opts.userId ?? harness.aliceOwner.userId,
    clientId,
    scopes: opts.scopes ?? ['library:read', 'library:write'],
  });
  return createAuthorizationCode(harness.prisma, {
    grantId: grant.id,
    redirectUri: REDIRECT,
    codeChallenge: challenge,
    resource: null,
  });
};

const exchange = (
  clientId: string,
  code: string,
  verifier: string,
  extra: Record<string, string> = {}
) =>
  request(app)
    .post('/mcp/oauth/token')
    .type('form')
    .send({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      ...extra,
    });

describe('registration and authorize', () => {
  it('registers a client and stores it', async () => {
    const client = await register();
    expect(client.client_id).toMatch(/[0-9a-f-]{36}/);
    const stored = await provider.clientsStore.getClient(client.client_id);
    expect(stored?.client_name).toBe('Claude');
    expect(stored?.redirect_uris).toEqual([REDIRECT]);
  });

  it('redirects a valid authorize request to the SPA consent page with every param', async () => {
    const client = await register();
    const { challenge } = pkce();
    const res = await request(app).get('/mcp/oauth/authorize').query({
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      scope: 'library:read',
      resource: 'https://books.example/mcp',
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe('https://books.example/connect');
    expect(Object.fromEntries(location.searchParams)).toEqual({
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      state: 'xyz',
      scope: 'library:read',
      resource: 'https://books.example/mcp',
    });
  });

  it('refuses an unregistered redirect_uri before redirecting anywhere', async () => {
    const client = await register();
    const res = await request(app).get('/mcp/oauth/authorize').query({
      client_id: client.client_id,
      redirect_uri: 'https://evil.example/cb',
      response_type: 'code',
      code_challenge: 'x',
      code_challenge_method: 'S256',
    });
    expect(res.status).toBe(400);
  });
});

describe('token exchange', () => {
  it('exchanges a code with the right verifier, then refuses the reused code', async () => {
    const client = await register();
    const { verifier, challenge } = pkce();
    const code = await mintCode(client.client_id, challenge);

    const ok = await exchange(client.client_id, code, verifier);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'library:read library:write',
    });
    expect(typeof ok.body.access_token).toBe('string');
    expect(typeof ok.body.refresh_token).toBe('string');

    const again = await exchange(client.client_id, code, verifier);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('invalid_grant');
  });

  it('refuses a wrong verifier', async () => {
    const client = await register();
    const { challenge } = pkce();
    const code = await mintCode(client.client_id, challenge);
    const res = await exchange(client.client_id, code, 'wrong-verifier');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('refuses a redirect_uri other than the one the code was bound to', async () => {
    const client = await register();
    const { verifier, challenge } = pkce();
    const code = await mintCode(client.client_id, challenge);
    const res = await exchange(client.client_id, code, verifier, {
      redirect_uri: 'https://client.example/other',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('refuses a code minted for another client', async () => {
    const owner = await register();
    const thief = await register();
    const { verifier, challenge } = pkce();
    const code = await mintCode(owner.client_id, challenge);
    const res = await exchange(thief.client_id, code, verifier);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });
});

describe('refresh', () => {
  it('rotates the refresh token and refuses the old one', async () => {
    const client = await register();
    const { verifier, challenge } = pkce();
    const code = await mintCode(client.client_id, challenge);
    const first = (await exchange(client.client_id, code, verifier)).body as {
      refresh_token: string;
    };

    const refreshed = await request(app).post('/mcp/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: first.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refresh_token).not.toBe(first.refresh_token);

    const replay = await request(app).post('/mcp/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: first.refresh_token,
    });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');
  });

  it('refuses widening a read-only grant to write', async () => {
    const client = await register();
    const { verifier, challenge } = pkce();
    const code = await mintCode(client.client_id, challenge, { scopes: ['library:read'] });
    const first = (await exchange(client.client_id, code, verifier)).body as {
      refresh_token: string;
    };
    const res = await request(app).post('/mcp/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: first.refresh_token,
      scope: 'library:read library:write',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_scope');
  });
});

describe('verifyAccessToken and revoke', () => {
  it('resolves a live token to the grant’s user, and rejects a revoked or orphaned one', async () => {
    const client = await register();
    const grant = await upsertGrant(harness.prisma, {
      userId: harness.aliceOwner.userId,
      clientId: client.client_id,
      scopes: ['library:read'],
    });
    const tokens = await issueTokens(harness.prisma, grant.id, ['library:read']);

    const info = await provider.verifyAccessToken(tokens.access_token);
    expect(info).toMatchObject({
      clientId: client.client_id,
      scopes: ['library:read'],
      extra: { userId: harness.aliceOwner.userId, username: 'alice', grantId: grant.id },
    });
    expect(info.expiresAt).toBeGreaterThan(Date.now() / 1000);

    const revoked = await request(app)
      .post('/mcp/oauth/revoke')
      .type('form')
      .send({ client_id: client.client_id, token: tokens.access_token });
    expect(revoked.status).toBe(200);
    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toMatchObject({
      errorCode: 'invalid_token',
    });

    const other = await issueTokens(harness.prisma, grant.id, ['library:read']);
    await deleteUser(harness.prisma, harness.editionsRoot, 'alice');
    await expect(provider.verifyAccessToken(other.access_token)).rejects.toMatchObject({
      errorCode: 'invalid_token',
    });
  });
});

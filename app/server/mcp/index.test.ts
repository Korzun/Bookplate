import * as crypto from 'crypto';

import request from 'supertest';

import { createHarness, type Harness } from '../graphql/test-util';
import { createServer } from '../server';
import { createMcpRouter } from './index';
import { issueTokens, upsertGrant } from './tokens';

vi.mock('../logger');

const BASE = new URL('https://books.example');

let harness: Harness;
let app: ReturnType<typeof createServer>;

beforeEach(async () => {
  harness = await createHarness({ mcpUrl: 'https://books.example/mcp' });
  const mcpRouter = createMcpRouter({
    baseUrl: BASE,
    prisma: harness.prisma,
    config: harness.config,
    contextDeps: harness.contextDeps,
    thumbnails: harness.thumbnails,
    replaceStaging: harness.replaceStaging,
    editionsRoot: harness.editionsRoot,
  });
  app = createServer({
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
});

afterEach(async () => {
  await harness.cleanup();
});

const mintToken = async (): Promise<string> => {
  await harness.prisma.mcpClient.create({
    data: {
      clientId: 'c1',
      clientIdIssuedAt: 1,
      metadata: JSON.stringify({ client_id: 'c1', redirect_uris: ['https://c.example/cb'] }),
      createdAt: Date.now(),
    },
  });
  const grant = await upsertGrant(harness.prisma, {
    userId: harness.aliceOwner.userId,
    clientId: 'c1',
    scopes: ['library:read', 'library:write'],
  });
  return (await issueTokens(harness.prisma, grant.id, ['library:read', 'library:write']))
    .access_token;
};

describe('OAuth metadata', () => {
  it('publishes authorization-server metadata with the /mcp/oauth endpoints', async () => {
    const res = await request(app).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      issuer: 'https://books.example/',
      authorization_endpoint: 'https://books.example/mcp/oauth/authorize',
      token_endpoint: 'https://books.example/mcp/oauth/token',
      registration_endpoint: 'https://books.example/mcp/oauth/register',
      revocation_endpoint: 'https://books.example/mcp/oauth/revoke',
      scopes_supported: ['library:read', 'library:write'],
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    });
  });

  it('publishes protected-resource metadata for /mcp', async () => {
    const res = await request(app).get('/.well-known/oauth-protected-resource/mcp');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      resource: 'https://books.example/mcp',
      authorization_servers: ['https://books.example/'],
      scopes_supported: ['library:read', 'library:write'],
    });
  });

  it('serves the registration endpoint under /mcp/oauth', async () => {
    const res = await request(app)
      .post('/mcp/oauth/register')
      .send({ redirect_uris: ['https://c.example/cb'], token_endpoint_auth_method: 'none' });
    expect(res.status).toBe(201);
  });
});

describe('POST /mcp', () => {
  it('answers 401 with a resource_metadata pointer when there is no token', async () => {
    const res = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain(
      'resource_metadata="https://books.example/.well-known/oauth-protected-resource/mcp"'
    );
  });

  it('answers 401 for a token it does not know', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer nope')
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(res.status).toBe(401);
  });

  it('rejects a body over 8 MB with a JSON 413 instead of hanging', async () => {
    const token = await mintToken();
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'x',
          params: { blob: 'a'.repeat(9 * 1024 * 1024) },
        })
      );
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Request body too large' });
  });

  it('accepts a 1 MB body from a valid token (the global 100 kb limit does not apply)', async () => {
    const token = await mintToken();
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'x',
          params: { blob: 'a'.repeat(1024 * 1024) },
        })
      );
    expect(res.status).not.toBe(413);
    expect(res.status).not.toBe(401);
  });
});

describe('the rest of the app', () => {
  it('still serves the SPA API', async () => {
    const res = await request(app).get('/api/public-config');
    expect(res.status).toBe(200);
  });
});

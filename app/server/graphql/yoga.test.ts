import express from 'express';
import request from 'supertest';

import { signAccessToken } from '../services/jwt';
import { createHarness, type Harness } from './test-util';
import { createGraphqlHandler } from './yoga';

vi.mock('../logger');

const jwtSecret = Buffer.from('c'.repeat(64), 'hex');

let harness: Harness;
let app: express.Express;

const buildApp = (isProduction: boolean): express.Express => {
  const server = express();
  server.use(
    '/graphql',
    createGraphqlHandler({
      prisma: harness.prisma,
      stores: harness.stores,
      config: harness.config,
      jwtSecret,
      isProduction,
    })
  );
  return server;
};

beforeEach(async () => {
  harness = await createHarness();
  app = buildApp(false);
});

afterEach(async () => {
  await harness.cleanup();
});

describe('POST /graphql', () => {
  it('answers a viewer query for a valid bearer token', async () => {
    const token = signAccessToken(jwtSecret, {
      userId: harness.aliceOwner.userId,
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });

    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{ viewer { username isAdmin } }' });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data).toEqual({ viewer: { username: 'alice', isAdmin: false } });
  });

  it('rejects a request with no Authorization header', async () => {
    const response = await request(app).post('/graphql').send({ query: '{ viewer { username } }' });

    expect(response.body.errors).toBeDefined();
    expect(response.body.data?.viewer ?? null).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = signAccessToken(Buffer.from('d'.repeat(64), 'hex'), {
      userId: harness.aliceOwner.userId,
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });

    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '{ viewer { username } }' });

    expect(response.body.errors).toBeDefined();
  });

  it('serves GraphiQL outside production', async () => {
    const response = await request(app).get('/graphql').set('Accept', 'text/html');

    expect(response.status).toBe(200);
    expect(response.text).toContain('graphiql');
  });

  it('does not serve GraphiQL in production', async () => {
    const response = await request(buildApp(true)).get('/graphql').set('Accept', 'text/html');

    expect(response.text ?? '').not.toContain('graphiql');
  });
});

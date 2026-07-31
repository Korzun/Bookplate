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

    expect(response.body.data?.viewer ?? null).toBeNull();
    // Pin the rejection to scope-auth's own message, not just any error: a
    // body-parsing failure, an unrelated resolver exception, or any other
    // fault would also leave `errors` non-empty, so asserting mere presence
    // would pass even if the builder-level `authenticated` scope were
    // misconfigured or removed for an unrelated reason.
    const message = (response.body.errors?.[0] as { message?: unknown } | undefined)?.message;
    expect(message).toBe('Not authorized to read fields for Query');
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

    expect(response.body.data?.viewer ?? null).toBeNull();
    // Same pin as the no-header case above: verifyAccessToken swallows the
    // signature-mismatch error and returns null (services/jwt.ts), so this
    // must produce the identical scope-auth rejection, not merely "an error
    // occurred" — a JWT exception that escaped unswallowed would surface as
    // a different message (or a 500), and this assertion would catch that.
    const message = (response.body.errors?.[0] as { message?: unknown } | undefined)?.message;
    expect(message).toBe('Not authorized to read fields for Query');
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

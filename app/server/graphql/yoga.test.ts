import express from 'express';
import request from 'supertest';

import { signAccessToken } from '../services/jwt';
import { createHarness, type Harness } from './test-util';
import { createGraphqlHandler } from './yoga';

vi.mock('../logger');

const jwtSecret = Buffer.from('c'.repeat(64), 'hex');

type ErrorBody = { errors?: { message?: string; extensions?: { code?: string } }[] };

const errorCode = (body: ErrorBody): string | undefined => body.errors?.[0]?.extensions?.code;
const errorMessage = (body: ErrorBody): string | undefined => body.errors?.[0]?.message;

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

// `cors: false` (yoga.ts) turns off yoga's default reflect-any-origin
// behaviour. The SPA is same-origin (served + proxied from the same host —
// see vite.config.ts's `/graphql` proxy entry), so there is no legitimate
// cross-origin caller to accommodate; a foreign Origin should see no CORS
// headers at all, not a reflected allow. Seen-to-fail: removing `cors: false`
// from yoga.ts turns this red — yoga's default CORS plugin reflects whatever
// `Origin` the request sends back in `Access-Control-Allow-Origin`.
describe('CORS', () => {
  it('does not grant a foreign Origin any CORS headers', async () => {
    const response = await request(app)
      .post('/graphql')
      .set('Origin', 'https://evil.example')
      .send({ query: '{ __typename }' });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
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
    // Pin the rejection to the auth code and HTTP status, not just any error:
    // a body-parsing failure, an unrelated resolver exception, or any other
    // fault would also leave `errors` non-empty, so asserting mere presence
    // would pass even if the builder-level `authenticated` scope were
    // misconfigured or removed for an unrelated reason. 401 (rather than
    // GraphQL's habitual 200) is what lets the client reuse its existing
    // token-refresh trigger.
    expect(response.status).toBe(401);
    expect(errorCode(response.body)).toBe('UNAUTHENTICATED');
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
    // must produce the identical rejection, not merely "an error occurred" —
    // a JWT exception that escaped unswallowed would surface as a different
    // code (or a 500), and this assertion would catch that.
    expect(response.status).toBe(401);
    expect(errorCode(response.body)).toBe('UNAUTHENTICATED');
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

// Both channels are reachable without a token: Pothos's field wrapping cannot
// gate graphql-js meta-fields, and validation errors are produced before any
// resolver (and so before any auth scope) runs.
describe('schema concealment', () => {
  const introspection = { query: '{ __schema { types { name } } }' };
  const misspelled = { query: '{ vieweer { username } }' };

  it('answers introspection outside production, so GraphiQL works', async () => {
    const response = await request(app).post('/graphql').send(introspection);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data?.__schema?.types).toEqual(
      expect.arrayContaining([{ name: 'Viewer' }])
    );
  });

  it('refuses introspection in production, even with a valid token', async () => {
    const token = signAccessToken(jwtSecret, {
      userId: harness.aliceOwner.userId,
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });

    const response = await request(buildApp(true))
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send(introspection);

    expect(response.body.data ?? null).toBeNull();
    expect(errorMessage(response.body)).toContain('introspection has been disabled');
  });

  it('suggests field names outside production', async () => {
    const response = await request(app).post('/graphql').send(misspelled);

    expect(errorMessage(response.body)).toContain('Did you mean "viewer"');
  });

  it('does not suggest field names in production', async () => {
    const response = await request(buildApp(true)).post('/graphql').send(misspelled);

    // The error still names the field the caller typed — that is their own
    // input — but must not hand back a real field name they did not know.
    const message = errorMessage(response.body) ?? '';
    expect(message).toContain('Cannot query field "vieweer"');
    expect(message).not.toContain('Did you mean');
    expect(message).not.toContain('viewer"');
  });
});

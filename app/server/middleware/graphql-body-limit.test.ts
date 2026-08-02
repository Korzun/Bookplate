import express, { Request, Response } from 'express';
import request from 'supertest';

import { createHarness, type Harness } from '../graphql/test-util';
import { createGraphqlHandler } from '../graphql/yoga';
import { signAccessToken } from '../services/jwt';
import { graphqlBodyLimit } from './graphql-body-limit';

vi.mock('../logger');

const jwtSecret = Buffer.from('c'.repeat(64), 'hex');
const GRAPHQL_BODY_LIMIT = 100 * 1024;

function makeApp(maxBytes: number, downstream: (req: Request, res: Response) => void) {
  const app = express();
  app.use(express.json());
  app.use(graphqlBodyLimit(maxBytes));
  app.post('/graphql', downstream);
  return app;
}

describe('graphqlBodyLimit', () => {
  it('rejects a body over the limit with 413, before the downstream handler runs', async () => {
    const downstream = vi.fn((_req: Request, res: Response) => res.json({ ok: true }));
    const app = makeApp(1024, downstream);

    const response = await request(app)
      .post('/graphql')
      .send({ query: 'a'.repeat(2000) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: 'Request body too large' });
    expect(downstream).not.toHaveBeenCalled();
  });

  it('passes a body at or under the limit through unchanged', async () => {
    const downstream = vi.fn((_req: Request, res: Response) => res.json({ ok: true }));
    const app = makeApp(1024, downstream);

    const response = await request(app).post('/graphql').send({ query: '{ x }' });

    expect(response.status).toBe(200);
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it('passes a request with no Content-Length header through unchanged', () => {
    // Exercised directly against the middleware (not over a real socket):
    // Node's http client always attaches SOME Content-Length or
    // Transfer-Encoding header for a real request, so a missing header is
    // easiest to simulate this way rather than fight supertest for it.
    const next = vi.fn();
    const req = { headers: {}, originalUrl: '/graphql' } as unknown as Request;
    const res = {} as Response;

    graphqlBodyLimit(1024)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

// Real integration, with server.ts's actual mount order (limit ahead of
// yoga): proves the 100kb limit rejects a request before any resolver runs,
// not merely before some abstract "downstream handler". `listBooksPage` is
// the store method `Library.entries` (library/model.ts) calls — spying on it
// directly is the only way to tell "yoga ran the query and it happened to
// error" apart from "yoga never ran the query at all", which mere HTTP
// status can't distinguish.
describe('graphqlBodyLimit + graphqlHandler (server.ts mount order)', () => {
  let harness: Harness;
  let app: express.Express;

  beforeEach(async () => {
    harness = await createHarness();
    const server = express();
    server.use(
      '/graphql',
      graphqlBodyLimit(GRAPHQL_BODY_LIMIT),
      createGraphqlHandler({
        prisma: harness.prisma,
        stores: harness.stores,
        config: harness.config,
        jwtSecret,
        isProduction: false,
      })
    );
    app = server;
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  const ENTRIES_QUERY =
    '{ viewer { library { entries(first: 1) { edges { node { __typename } } } } } }';
  const token = () =>
    signAccessToken(jwtSecret, {
      userId: harness.aliceOwner.userId,
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });

  it('rejects a 101kb body with 413 and never calls the resolver', async () => {
    const spy = vi.spyOn(harness.stores.book, 'listBooksPage');
    // Padding lives in a GraphQL comment so the query stays syntactically
    // valid — the point is to prove the oversized body never reaches parse
    // or execute, not to also exercise a malformed-query path.
    const padded = `# ${'a'.repeat(101 * 1024)}\n${ENTRIES_QUERY}`;

    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${token()}`)
      .send({ query: padded });

    expect(response.status).toBe(413);
    expect(response.body.data).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('sanity check: the same query under the limit does reach the resolver', async () => {
    const spy = vi.spyOn(harness.stores.book, 'listBooksPage');

    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${token()}`)
      .send({ query: ENTRIES_QUERY });

    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

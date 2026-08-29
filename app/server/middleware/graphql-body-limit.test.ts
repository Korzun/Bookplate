import * as http from 'http';
import type { AddressInfo } from 'net';

import express, { Request, Response } from 'express';
import request from 'supertest';

import { createHarness, type Harness } from '../graphql/test-util';
import { createGraphqlHandler } from '../graphql/yoga';
import { signAccessToken } from '../services/jwt';
import * as libraryPageModule from '../services/library-page';
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

  // C-3 fix (task-3 review): a POST with no `Content-Length` can still
  // carry an arbitrarily large body via chunked transfer-encoding — the
  // review proved a 50MB unauthenticated chunked POST sailed through the
  // length-check-only version at HTTP 200. This is the unit-level pin of
  // that fix; the real-socket chunked-request proof lives in the
  // integration describe block below.
  it('rejects a POST with no Content-Length header with 411, before the downstream handler runs', async () => {
    const downstream = vi.fn((_req: Request, res: Response) => res.json({ ok: true }));
    const app = express();
    app.use(graphqlBodyLimit(1024));
    app.post('/graphql', downstream);

    // supertest/superagent always attaches Content-Length for a `.send()`
    // body, so the "no header" case is exercised directly against the
    // middleware here (a real chunked socket request is exercised below).
    const next = vi.fn();
    const req = { method: 'POST', headers: {}, originalUrl: '/graphql' } as unknown as Request;
    let statusCode: number | undefined;
    let body: unknown;
    const res = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (payload: unknown) => {
        body = payload;
        return res;
      },
    } as unknown as Response;

    graphqlBodyLimit(1024)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusCode).toBe(411);
    expect(body).toEqual({ error: 'Content-Length required' });
  });

  it("passes a non-POST request with no Content-Length header through unchanged (GraphiQL's own GET)", () => {
    const next = vi.fn();
    const req = { method: 'GET', headers: {}, originalUrl: '/graphql' } as unknown as Request;
    const res = {} as Response;

    graphqlBodyLimit(1024)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

// Real integration, with server.ts's actual mount order (limit ahead of
// yoga): proves the 100kb limit rejects a request before any resolver runs,
// not merely before some abstract "downstream handler". `listBooksPage`
// (`services/library-page.ts`) is the function `Library.entries`
// (library/model.ts) calls directly — spying on it via a namespace import
// (same pattern as `routes/ui.test.ts`'s `applyEpubChangesModule`/
// `validationModule` spies) is the only way to tell "yoga ran the query and
// it happened to error" apart from "yoga never ran the query at all", which
// mere HTTP status can't distinguish.
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
    const spy = vi.spyOn(libraryPageModule, 'listBooksPage');
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
    const spy = vi.spyOn(libraryPageModule, 'listBooksPage');

    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${token()}`)
      .send({ query: ENTRIES_QUERY });

    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

/**
 * The actual C-3 exploit, reproduced and closed: a POST with
 * `Transfer-Encoding: chunked` and no `Content-Length`. supertest/superagent
 * always sets `Content-Length` for `.send()`, so this needs a real socket —
 * Node's own `http.request` defaults to chunked transfer-encoding whenever
 * `Content-Length` is not explicitly set and the body is written in pieces,
 * which is exactly the shape the review's probe used. Unauthenticated (no
 * Authorization header) — same as the review's proof — because the point is
 * that this bypass required no auth at all.
 */
describe('graphqlBodyLimit + graphqlHandler — chunked transfer-encoding bypass (C-3)', () => {
  let harness: Harness;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    harness = await createHarness();
    const app = express();
    app.use(
      '/graphql',
      graphqlBodyLimit(GRAPHQL_BODY_LIMIT),
      createGraphqlHandler({
        prisma: harness.prisma,
        stores: harness.stores,
        config: harness.config,
        jwtSecret,
        isProduction: true,
      })
    );
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await harness.cleanup();
  });

  const sendChunked = (path: string, chunks: string[]): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const req = http.request(
        url,
        {
          method: 'POST',
          // Deliberately NOT setting Content-Length — Node's http client
          // then defaults to `Transfer-Encoding: chunked` on its own.
          headers: { 'content-type': 'application/json' },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk.toString()));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        }
      );
      req.on('error', reject);
      for (const chunk of chunks) req.write(chunk);
      req.end();
    });

  it('rejects a chunked, Content-Length-less POST with 411 and never calls the resolver', async () => {
    const spy = vi.spyOn(libraryPageModule, 'listBooksPage');
    const payload = JSON.stringify({
      query: `# ${'a'.repeat(200 * 1024)}\n{ __typename }`,
    });

    const response = await sendChunked('/graphql', [payload]);

    expect(response.status).toBe(411);
    expect(spy).not.toHaveBeenCalled();
  });
});

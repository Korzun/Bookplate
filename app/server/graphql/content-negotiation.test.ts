import express from 'express';
import request from 'supertest';

import { signAccessToken } from '../services/jwt';
import { createHarness, type Harness } from './test-util';
import { createGraphqlHandler } from './yoga';

vi.mock('../logger');

const jwtSecret = Buffer.from('c'.repeat(64), 'hex');
const GRAPHQL_RESPONSE_JSON = 'application/graphql-response+json';

let harness: Harness;
let app: express.Express;

const aliceToken = () =>
  signAccessToken(jwtSecret, {
    userId: harness.aliceOwner.userId,
    username: 'alice',
    isAdmin: false,
    mustChangePassword: false,
  });

beforeEach(async () => {
  harness = await createHarness();
  const server = express();
  server.use(
    '/graphql',
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

/**
 * Pins the three-part contract Apollo's client-side `errorLink` will depend
 * on once the client migration lands (design spec, §4 "Content negotiation
 * test"): the negotiated response Content-Type, the 401 + `UNAUTHENTICATED`
 * shape that triggers Apollo's token-refresh flow, and that a validation
 * error under an AUTHENTICATED caller is NOT mistaken for that same trigger.
 * Behavior believed correct today (yoga implements the GraphQL-over-HTTP
 * spec's content negotiation and this schema's own `unauthorizedError`,
 * builder.ts, already sets `extensions.code`/`http.status`) — these tests
 * make it a contract a later change cannot silently drift out from under the
 * client.
 */
describe('content negotiation contract', () => {
  it('echoes `application/graphql-response+json` back as the response Content-Type', async () => {
    const response = await request(app)
      .post('/graphql')
      .set('Accept', GRAPHQL_RESPONSE_JSON)
      .set('Authorization', `Bearer ${aliceToken()}`)
      .send({ query: '{ viewer { username } }' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain(GRAPHQL_RESPONSE_JSON);
    expect(response.body.errors).toBeUndefined();
  });

  it('an unauthenticated request gets HTTP 401 with extensions.code UNAUTHENTICATED', async () => {
    const response = await request(app)
      .post('/graphql')
      .set('Accept', GRAPHQL_RESPONSE_JSON)
      .send({ query: '{ viewer { username } }' });

    expect(response.status).toBe(401);
    expect(response.body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('an authenticated caller with a validation error is NOT treated as an auth failure', async () => {
    const response = await request(app)
      .post('/graphql')
      .set('Accept', GRAPHQL_RESPONSE_JSON)
      .set('Authorization', `Bearer ${aliceToken()}`)
      .send({ query: '{ viewer { thisFieldDoesNotExist } }' });

    // Pinning the ACTUAL observed status (400 — the GraphQL-over-HTTP spec's
    // status for `GRAPHQL_VALIDATION_FAILED` under a negotiated
    // `application/graphql-response+json` response), not merely "not 401":
    // an errorLink that treated every non-200 as "refresh the token" would
    // loop forever on a plain typo.
    expect(response.status).toBe(400);
    expect(response.body.data ?? null).toBeNull();
    expect(response.body.errors?.[0]?.extensions?.code).toBe('GRAPHQL_VALIDATION_FAILED');
  });

  // Task 4 (query-cost-control plan): `cost-limit.ts`'s `costLimitRule` now
  // enforces `BREADTH_BUDGET`/`COMPLEXITY_BUDGET`, reporting through the
  // same `ValidationContext` every other validation rule (including the
  // `GRAPHQL_VALIDATION_FAILED` case above) uses — so a budget rejection
  // gets the SAME negotiated-content-type/400 treatment for free. Pinned
  // here specifically because the code must be DISTINGUISHABLE from a plain
  // validation typo (`GRAPHQL_VALIDATION_FAILED`, above): an `errorLink`
  // that only checked "is this a 400" couldn't tell "you asked for too
  // much" apart from "you made a typo," and the two call for different
  // client behavior (backing off page size vs. surfacing the query itself).
  it('an authenticated caller exceeding the query cost budget gets HTTP 400 with extensions.code QUERY_COMPLEXITY, distinct from the plain validation-error code above', async () => {
    const booksHop = (n: number): string =>
      n === 0 ? 'id' : `books(first: 100) { edges { node { series { ${booksHop(n - 1)} } } } }`;
    const overBudget = `{ nodes(ids: ["x"]) { ... on Series { ${booksHop(3)} } } }`;

    const response = await request(app)
      .post('/graphql')
      .set('Accept', GRAPHQL_RESPONSE_JSON)
      .set('Authorization', `Bearer ${aliceToken()}`)
      .send({ query: overBudget });

    expect(response.status).toBe(400);
    expect(response.body.data ?? null).toBeNull();
    const codes = (response.body.errors as { extensions?: { code?: string } }[]).map(
      (error) => error.extensions?.code
    );
    expect(codes).toContain('QUERY_COMPLEXITY');
  });

  it('an authenticated caller with a syntactically malformed query is NOT treated as an auth failure', async () => {
    const response = await request(app)
      .post('/graphql')
      .set('Accept', GRAPHQL_RESPONSE_JSON)
      .set('Authorization', `Bearer ${aliceToken()}`)
      .send({ query: '{ viewer { username ' }); // unterminated selection set

    // Same status as the validation-error arm above (400,
    // `GRAPHQL_PARSE_FAILED`) — a different failure code, the same
    // "definitely not an auth failure" shape.
    expect(response.status).toBe(400);
    expect(response.body.errors?.[0]?.extensions?.code).toBe('GRAPHQL_PARSE_FAILED');
  });
});

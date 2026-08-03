import express from 'express';
import { getIntrospectionQuery } from 'graphql';
import request from 'supertest';

import { logger } from '../logger';
import { createHarness, type Harness } from './test-util';
import { createGraphqlHandler } from './yoga';

vi.mock('../logger');

/**
 * Real-HTTP twin of `cost-limit.test.ts`'s unit-level suite — same file
 * split `depth-limit.ts`/`depth-limit-integration.test.ts` already use
 * (`depth-limit.test.ts` is pure boundary math via `validate()`;
 * `depth-limit-integration.test.ts` is real HTTP, real schema, a real
 * harness). This file covers the brief's own "Integration-level (real HTTP)
 * for at least the 3-hop cycle and one screen query" instruction, plus the
 * GraphiQL-still-works-in-dev check (binding constraint #4 — an integration
 * check, not a claim) and the operator-visibility (WARN log) proof that a
 * cost-budget rejection rides the SAME mechanism `depth-limit.ts`'s own
 * rejections already do.
 */
describe('useCostLimit — over real HTTP, real schema (Task 4: now enforces; still logs {breadth, complexity} at info unconditionally, no query text/variables)', () => {
  const jwtSecret = Buffer.from('c'.repeat(64), 'hex');
  let harness: Harness;
  let app: express.Express;

  const costLoggerSpy = (): { info: Mock } => {
    const mocked = vi.mocked(logger);
    const index = mocked.mock.calls.findIndex(([namespace]) => namespace === 'GraphQL:cost');
    if (index === -1) throw new Error("logger('GraphQL:cost') was never called");
    return mocked.mock.results[index]?.value as { info: Mock };
  };
  // Captured once at module load, same reasoning as
  // `yoga-operation-logging.test.ts`'s own `operationLoggerSpies`.
  const spy = costLoggerSpy();

  beforeEach(async () => {
    spy.info.mockClear();
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

  it('logs {operationName, breadth, complexity} at info for a clean, successful operation — no query text or variables', async () => {
    const { signAccessToken } = await import('../services/jwt');
    const token = signAccessToken(jwtSecret, {
      userId: harness.aliceOwner.userId,
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });

    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'query MyGridQuery { viewer { username } }' });

    expect(response.status).toBe(200);
    expect(spy.info).toHaveBeenCalledTimes(1);

    const line = JSON.parse(spy.info.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({ operationName: 'MyGridQuery' });
    expect(typeof line['breadth']).toBe('number');
    expect(typeof line['complexity']).toBe('number');
    expect(JSON.stringify(line)).not.toContain('MyGridQuery { viewer { username } }');
  });

  it('still logs a query the depth limit ALSO rejects — a measurement pass, not a guard', async () => {
    // Same over-depth shape `depth-limit-integration.test.ts` rejects at
    // MAX_DEPTH — nothing about this rule changes that verdict.
    const deepQuery = `{
      viewer { library { entries(first: 1) { edges { node { ... on Book {
        series { books(first: 1) { edges { node {
          series { books(first: 1) { edges { node { id } } } }
        } } } }
      } } } } } }
    }`;

    const response = await request(app).post('/graphql').send({ query: deepQuery });

    expect(response.body.errors?.[0]?.message).toContain('nested too deeply');
    expect(spy.info).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.info.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line['operationName']).toBe('anonymous');
    expect(typeof line['breadth']).toBe('number');
  });

  // Task 4: the rule now enforces. This is the integration-level twin of
  // `cost-limit.test.ts`'s "budget enforcement" unit tests — asserting the
  // full response shape (400, `QUERY_COMPLEXITY` present in `errors`,
  // `data: null`), not just that `context.reportError` was called.
  //
  // Over the FULL pipeline (unlike the unit tests, which run `costLimitRule`
  // alone) this exact fixture ALSO measures depth 13 — `depth-limit.ts`'s
  // own `MAX_DEPTH` (12) independently rejects it too, a real
  // defense-in-depth result (two different rules, two different metrics,
  // same correct verdict), not a conflict — so this test looks for
  // `QUERY_COMPLEXITY` among `errors` rather than assuming it is the only or
  // first one. `extensions.http` (the field this rule sets to steer the
  // overall response status) is NOT itself present in what the client
  // receives — yoga consumes it internally to compute `response.status` and
  // strips it before serializing, the same behavior `content-negotiation.
  // test.ts` already established for `UNAUTHENTICATED`/`FORBIDDEN` (it only
  // ever asserts `extensions.code`, never `extensions.http`).
  it('rejects the 3-hop nodes()-rooted cycle over real HTTP — 400, extensions.code QUERY_COMPLEXITY present, data null — and STILL logs {breadth, complexity} at info (measurement pass, not a guard)', async () => {
    const booksHop = (n: number): string =>
      n === 0 ? 'id' : `books(first: 100) { edges { node { series { ${booksHop(n - 1)} } } } }`;
    const threeHopCycle = `{ nodes(ids: ["x"]) { ... on Series { ${booksHop(3)} } } }`;

    // `Accept: application/graphql-response+json` negotiates the
    // spec-defined status code — same reasoning `content-negotiation.test.ts`
    // documents (without it, yoga's legacy-compatible default is 200 even
    // when `errors` is populated).
    const response = await request(app)
      .post('/graphql')
      .set('Accept', 'application/graphql-response+json')
      .send({ query: threeHopCycle });

    expect(response.status).toBe(400);
    expect(response.body.data ?? null).toBeNull();
    const codes = (response.body.errors as { extensions?: { code?: string } }[]).map(
      (error) => error.extensions?.code
    );
    expect(codes).toContain('QUERY_COMPLEXITY');

    expect(spy.info).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.info.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line['operationName']).toBe('anonymous');
    expect(line['complexity']).toBeGreaterThan(1_000_000);
  });

  it('rejects the scalar-list alias attack over real HTTP with extensions.code QUERY_BREADTH (this shape is well within MAX_DEPTH, so this pins cost-limit is what caught it, not depth-limit)', async () => {
    const source = `{ ${Array.from(
      { length: 200 },
      (_, i) => `a${i}: viewer { library { authors subjects } }`
    ).join(' ')} }`;

    const response = await request(app)
      .post('/graphql')
      .set('Accept', 'application/graphql-response+json')
      .send({ query: source });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ extensions: expect.objectContaining({ code: 'QUERY_BREADTH' }) }),
    ]);
  });

  it('accepts the richest legit grid fixture over real HTTP (breadth 41 / complexity 3823) — the "at least one screen query" integration check', async () => {
    const { signAccessToken } = await import('../services/jwt');
    const token = signAccessToken(jwtSecret, {
      userId: harness.aliceOwner.userId,
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    const richGrid = `
      fragment BookCard on Book {
        series { id name }
        progress { percentage }
        validation { id valid }
        pendingFix { state { autoFixes { field kind from to } } }
      }
      { viewer { library { entries(first: 20) {
        edges { node {
          ... on Book { ...BookCard }
          ... on Series { books(first: 10) { edges { node { ...BookCard } } } }
        } }
        pageInfo { hasNextPage endCursor }
      } } } }`;

    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: richGrid });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
  });

  // Binding constraint #4: "Introspection stays exempt (Task 3 built it);
  // confirm GraphiQL still works in dev after enforcement — an integration
  // check, not a claim." `yoga.test.ts`'s own "answers introspection outside
  // production" test uses a partial `{ __schema { types { name } } }` query,
  // not the FULL query GraphiQL's own schema-fetch actually sends
  // (`getIntrospectionQuery()`) — that full query measures breadth/
  // complexity 220 (task-3-report.md's calibration table). Breadth (220)
  // clears `BREADTH_BUDGET` (100) more than 2×; complexity (220) is nowhere
  // near `COMPLEXITY_BUDGET` (25,000) — it is BREADTH the exemption has to
  // protect this query from, so this is the one fixture in this whole suite
  // where "does it still pass" is genuinely non-obvious without running it
  // for real, end-to-end, over HTTP, exactly as GraphiQL's own client would.
  it("GraphiQL's own schema-fetch (getIntrospectionQuery()) still succeeds in dev after enforcement, unauthenticated — breadth 220 would fail BREADTH_BUDGET if the introspection exemption regressed", async () => {
    const response = await request(app).post('/graphql').send({ query: getIntrospectionQuery() });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data?.__schema?.types).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Viewer' })])
    );
    // Exempt operations never reach `onMeasured` either (isIntrospectionOnly
    // short-circuits before the walk runs) — the measurement log line stays
    // silent for introspection, same as `cost-limit.test.ts`'s own
    // `costLimitRule — introspection exemption` unit tests already pin.
    expect(spy.info).not.toHaveBeenCalled();
  });

  // Step 5 / operator-visibility: a cost-budget rejection must log at WARN,
  // same as every other validation rejection in this pipeline. `cost-limit.
  // ts`'s own `costLimitRule` doc comment explains WHY no new logging code
  // was needed for this — `useOperationLogging`'s existing `onValidate` hook
  // already observes the shared `ValidationContext` result and logs one WARN
  // line for ANY rejected operation, regardless of which rule rejected it
  // (task-3 review's own M-4 finding). This test is the proof that claim is
  // actually true for THIS rule's own rejections, not just for depth-limit's
  // (which `yoga-operation-logging.test.ts` already pins).
  it('a cost-budget rejection logs one WARN line via the existing operator-visibility mechanism (useOperationLogging), same as a depth-limit rejection already does', async () => {
    const operationsLoggerSpy = (): { info: Mock; warn: Mock } => {
      const mocked = vi.mocked(logger);
      const index = mocked.mock.calls.findIndex(
        ([namespace]) => namespace === 'GraphQL:operations'
      );
      if (index === -1) throw new Error("logger('GraphQL:operations') was never called");
      return mocked.mock.results[index]?.value as { info: Mock; warn: Mock };
    };
    const opsSpy = operationsLoggerSpy();
    opsSpy.info.mockClear();
    opsSpy.warn.mockClear();

    const source = `{ ${Array.from(
      { length: 200 },
      (_, i) => `a${i}: viewer { library { authors subjects } }`
    ).join(' ')} }`;

    const response = await request(app).post('/graphql').send({ query: source });

    expect(response.body.errors?.[0]?.extensions?.code).toBe('QUERY_BREADTH');
    expect(opsSpy.warn).toHaveBeenCalledTimes(1);
    expect(opsSpy.info).not.toHaveBeenCalled();
    const line = JSON.parse(opsSpy.warn.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({ operationName: 'anonymous' });
    expect(line['errorCount']).toBeGreaterThan(0);
  });
});

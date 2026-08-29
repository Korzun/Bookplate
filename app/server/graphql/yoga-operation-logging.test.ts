import express from 'express';
import { parse } from 'graphql';
import request from 'supertest';

import { logger } from '../logger';
import { signAccessToken } from '../services/jwt';
import { createHarness, type Harness } from './test-util';
import { createGraphqlHandler } from './yoga';
import { useOperationLogging } from './yoga-plugins';

vi.mock('../logger');

const jwtSecret = Buffer.from('c'.repeat(64), 'hex');

/**
 * `logger(namespace)` is itself a `vi.fn()` (see `__mocks__/logger.ts`) that
 * returns a FRESH `{debug, info, warn, error}` spy object on every call —
 * every module in the import graph that does `const log = logger('X')` at
 * its own top level calls it once, so this file's process may hold several
 * such objects. `yoga-plugins.ts` uses the namespace `'GraphQL:operations'`
 * specifically so it can be picked out unambiguously here, distinct from
 * yoga.ts's own `logger('GraphQL')` (yoga's internal diagnostic bridge).
 */
const operationLoggerSpies = (): { info: Mock; warn: Mock } => {
  const mocked = vi.mocked(logger);
  const index = mocked.mock.calls.findIndex(([namespace]) => namespace === 'GraphQL:operations');
  if (index === -1) throw new Error("logger('GraphQL:operations') was never called");
  return mocked.mock.results[index]?.value as { info: Mock; warn: Mock };
};

let harness: Harness;
let app: express.Express;
// Captured once, at module load — `yoga-plugins.ts`'s own
// `logger('GraphQL:operations')` call happens exactly once, the first time
// the module is imported (module caching), not once per test. Cleared
// between tests below instead of re-fetched.
const spies = operationLoggerSpies();

const aliceToken = () =>
  signAccessToken(jwtSecret, {
    userId: harness.aliceOwner.userId,
    username: 'alice',
    isAdmin: false,
    mustChangePassword: false,
  });

beforeEach(async () => {
  spies.info.mockClear();
  spies.warn.mockClear();
  harness = await createHarness();
  const server = express();
  server.use(
    '/graphql',
    createGraphqlHandler({
      prisma: harness.prisma,
      scanJobs: harness.scanJobs,
      thumbnails: harness.thumbnails,
      replaceStaging: harness.replaceStaging,
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

describe('operation logging — over real HTTP', () => {
  it('logs one info line for a clean, successful operation — no query text or variables', async () => {
    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${aliceToken()}`)
      .send({ query: 'query MyGridQuery { viewer { username } }' });

    expect(response.status).toBe(200);
    expect(spies.info).toHaveBeenCalledTimes(1);
    expect(spies.warn).not.toHaveBeenCalled();

    const line = JSON.parse(spies.info.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({ operationName: 'MyGridQuery', errorCount: 0 });
    expect(typeof line['viewerId']).toBe('string');
    expect(typeof line['durationMs']).toBe('number');
    // The whole point of the contract: never the query text or variables.
    expect(JSON.stringify(line)).not.toContain('MyGridQuery { viewer { username } }');
  });

  it('logs one warn line for an operation that errors, with errorCount > 0', async () => {
    // No Authorization header — the `authenticated` scope denies every
    // field, an execute-time (not validate-time) rejection, so it reaches
    // `onExecute`/`onExecuteDone` exactly like any other resolver error.
    const response = await request(app)
      .post('/graphql')
      .send({ query: 'query Unauthed { viewer { username } }' });

    expect(response.status).toBe(401);
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.info).not.toHaveBeenCalled();

    const line = JSON.parse(spies.warn.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({ operationName: 'Unauthed', viewerId: 'anon' });
    expect(line['errorCount']).toBeGreaterThan(0);
  });

  it("falls back to 'anonymous' for an unnamed operation", async () => {
    await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${aliceToken()}`)
      .send({ query: '{ viewer { username } }' });

    const line = JSON.parse(spies.info.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line['operationName']).toBe('anonymous');
  });

  // Task-3 review, M-4: without an `onValidate` hook, a query rejected at
  // validation (never reaches `onExecute`) logged NOTHING — an operator
  // watching logs would see zero lines while an attacker probed the depth
  // limit (the exact class of abuse C-1/C-2 exploited). This is the
  // regression test for that gap.
  it('logs one warn line for a validation-stage rejection (depth limit), even though execute never runs', async () => {
    // Real schema fields throughout (the `Book.series ↔ Series.books`
    // two-hop amplification shape, same as `depth-limit-integration.test.ts`
    // and `yoga.test.ts`'s introspection-exemption tests) — deliberately
    // NOT a made-up field name, which would additionally trip graphql-js's
    // own field-existence validation and pollute `errorCount`/the message
    // assertion below with an unrelated error.
    const deepQuery = `{
      viewer { library { entries(first: 1) { edges { node { ... on Book {
        series { books(first: 1) { edges { node {
          series { books(first: 1) { edges { node { id } } } }
        } } } }
      } } } } } }
    }`;

    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${aliceToken()}`)
      .send({ query: deepQuery });

    expect(response.body.errors?.[0]?.message).toContain('nested too deeply');
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.info).not.toHaveBeenCalled();

    const line = JSON.parse(spies.warn.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({ operationName: 'anonymous', errorCount: 1 });
    expect(typeof line['durationMs']).toBe('number');
  });

  // Task 4 (query-cost-control plan): `cost-limit.ts`'s `costLimitRule` now
  // enforces `BREADTH_BUDGET`/`COMPLEXITY_BUDGET` on the same
  // `ValidationContext` the depth-limit test above already proves this
  // WARN-logging mechanism observes — this is the same regression test,
  // for the new rule, not a new mechanism: `cost-limit.ts`'s own doc
  // comment is explicit that no new logging code was written for this,
  // because this pre-existing `onValidate` hook already covers it. The
  // scalar-list alias attack (breadth 800, well within `MAX_DEPTH`) is used
  // specifically so this test isolates cost-limit's own rejection, not a
  // combined depth-limit + cost-limit one.
  it('logs one warn line for a validation-stage rejection (cost budget), even though execute never runs', async () => {
    const scalarListAttack = `{ ${Array.from(
      { length: 200 },
      (_, i) => `a${i}: viewer { library { authors subjects } }`
    ).join(' ')} }`;

    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${aliceToken()}`)
      .send({ query: scalarListAttack });

    expect(response.body.errors?.[0]?.extensions?.code).toBe('QUERY_BREADTH');
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.info).not.toHaveBeenCalled();

    const line = JSON.parse(spies.warn.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({ operationName: 'anonymous', errorCount: 1 });
    // Same N-3 fix the depth-limit test above exercises — a cost-budget
    // rejection at validation time must attribute to the real authenticated
    // viewer, not fall through to 'anon'.
    expect(line['viewerId']).toBe(harness.aliceOwner.userId);
  });

  // Final-review-wave, T3 N-3 (narrower than first recorded — only
  // `onValidate` was affected; `onExecute` already attributed correctly,
  // pinned separately below). Before the fix, THIS line always read
  // `viewerId: 'anon'`, even though the request above (a sibling test) is
  // authenticated: envelop hadn't run `createContext` yet at `onValidate`
  // time, so the only prior signal (`context.viewer`) didn't exist. An
  // operator watching logs could see someone probed the depth limit, but
  // never attribute it to a session.
  it("attributes a validation-stage rejection (depth limit) to the real authenticated viewer, not 'anon'", async () => {
    const deepQuery = `{
      viewer { library { entries(first: 1) { edges { node { ... on Book {
        series { books(first: 1) { edges { node {
          series { books(first: 1) { edges { node { id } } } }
        } } } }
      } } } } } }
    }`;

    const response = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${aliceToken()}`)
      .send({ query: deepQuery });

    expect(response.body.errors?.[0]?.message).toContain('nested too deeply');
    expect(spies.warn).toHaveBeenCalledTimes(1);

    const line = JSON.parse(spies.warn.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line['viewerId']).toBe(harness.aliceOwner.userId);
  });

  it("logs the admin session's username, not 'anon' — a real session must not read as anonymous", async () => {
    // No `userId` at all — `AuthUser.userId` is `string | undefined`
    // (services/jwt.ts), never `null`; this IS the config-based admin's
    // real shape, the same one `viewerFromHeader` (context.ts) produces.
    const adminToken = signAccessToken(jwtSecret, {
      username: 'admin',
      isAdmin: true,
      mustChangePassword: false,
    });

    await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ query: 'query AsAdmin { viewer { username } }' });

    const line = JSON.parse(spies.info.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line['viewerId']).toBe('admin');
  });
});

/**
 * Direct plugin-hook tests for the subscription half of `useOperationLogging`
 * (yoga-plugins.ts). Deliberately NOT driven over a real SSE connection —
 * unlike `scan-progress-sse.test.ts`'s HTTP-level tests, what's being pinned
 * here is specifically "one log line for the whole stream, not one per
 * event", which needs multiple published events on a controlled timeline to
 * demonstrate; racing an `AbortController` against yoga's own stream teardown
 * over a real socket would make that timeline non-deterministic. Calling the
 * plugin's own hooks directly, with a fake async-iterable stream, pins the
 * exact same behavior deterministically.
 */
describe('operation logging — subscription hooks, called directly', () => {
  const fakeContext = {
    viewer: { userId: 'u1', username: 'alice', isAdmin: false, mustChangePassword: false },
  };
  const fakeArgs = {
    // A REAL parsed document (not a stub) — `operationNameOf` (yoga-plugins.ts)
    // reads the actual operation's `name` node off `args.document`, which a
    // hand-built `{ definitions: [] }` stub cannot supply.
    document: parse('subscription ScanProgress { x }'),
    operationName: 'ScanProgress',
    contextValue: fakeContext,
  };

  it('a subscribe-time denial (non-async-iterable result) logs immediately, once', () => {
    const plugin = useOperationLogging(jwtSecret);
    const onSubscribeResult = plugin.onSubscribe?.({
      args: fakeArgs,
    } as Parameters<NonNullable<typeof plugin.onSubscribe>>[0])?.onSubscribeResult;
    if (!onSubscribeResult) throw new Error('plugin did not return onSubscribeResult');

    onSubscribeResult({
      result: { errors: [{ message: 'Forbidden' }] },
    } as Parameters<typeof onSubscribeResult>[0]);

    expect(spies.warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spies.warn.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({ operationName: 'ScanProgress', viewerId: 'u1', errorCount: 1 });
  });

  it('a live stream logs exactly once, at onEnd, aggregating every event — never per event', () => {
    const plugin = useOperationLogging(jwtSecret);
    const onSubscribeResult = plugin.onSubscribe?.({
      args: fakeArgs,
    } as Parameters<NonNullable<typeof plugin.onSubscribe>>[0])?.onSubscribeResult;
    if (!onSubscribeResult) throw new Error('plugin did not return onSubscribeResult');

    const fakeStream = { [Symbol.asyncIterator]: () => ({}) };
    const hooks = onSubscribeResult({
      result: fakeStream,
    } as Parameters<typeof onSubscribeResult>[0]);
    if (!hooks?.onNext || !hooks.onEnd) throw new Error('expected onNext/onEnd for a live stream');

    // Three published events, only one carrying an error — nothing should be
    // logged for any of them individually.
    hooks.onNext({ result: { data: { scanProgress: { state: 'RUNNING' } } } } as Parameters<
      NonNullable<typeof hooks.onNext>
    >[0]);
    hooks.onNext({ result: { errors: [{ message: 'transient' }] } } as Parameters<
      NonNullable<typeof hooks.onNext>
    >[0]);
    hooks.onNext({ result: { data: { scanProgress: { state: 'DONE' } } } } as Parameters<
      NonNullable<typeof hooks.onNext>
    >[0]);
    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();

    hooks.onEnd();

    // Exactly one line total (not three), and it is a warn because one of
    // the three events carried an error.
    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spies.warn.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({ operationName: 'ScanProgress', viewerId: 'u1', errorCount: 1 });
  });
});

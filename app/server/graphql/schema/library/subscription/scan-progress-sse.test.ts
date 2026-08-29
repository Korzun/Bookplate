import * as http from 'http';
import type { AddressInfo } from 'net';

import express from 'express';

import { graphqlBodyLimit } from '../../../../middleware/graphql-body-limit';
import { signAccessToken } from '../../../../services/jwt';
import { createHarness, type Harness } from '../../../test-util';
import { createGraphqlHandler } from '../../../yoga';

vi.mock('../../../../logger');

const jwtSecret = Buffer.from('c'.repeat(64), 'hex');

let harness: Harness;
let server: http.Server;
let baseUrl: string;
let aliceLibraryGlobalId: string;

const tokenFor = (userId: string | null, username: string, isAdmin: boolean): string =>
  signAccessToken(jwtSecret, { userId, username, isAdmin, mustChangePassword: false });

const SUBSCRIPTION = `
  subscription ($libraryId: ID!) {
    scanProgress(libraryId: $libraryId) { id state }
  }
`;

beforeEach(async () => {
  harness = await createHarness();
  aliceLibraryGlobalId = await harness.seedNodeFor('Library');

  const app = express();
  app.use(
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
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await harness.cleanup();
});

/**
 * Reads chunks off `body` until `event: next` has appeared (skipping the SSE
 * processor's own leading keep-alive ping frame — `getSSEProcessor` in
 * graphql-yoga always enqueues `:\n\n` first, "because some browsers dont
 * accept a header flush" — see that function's own comment), and returns the
 * parsed `data:` payload of that first real event.
 */
const firstSseEvent = async (body: ReadableStream<Uint8Array>): Promise<unknown> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error('SSE stream ended before an `event: next` frame arrived');
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes('event: next')) break;
  }
  await reader.cancel();
  const dataLine = buffer.split('\n').find((line) => line.startsWith('data: '));
  if (dataLine === undefined) throw new Error(`no data: line in SSE frame: ${buffer}`);
  return JSON.parse(dataLine.slice('data: '.length));
};

/**
 * Reads the WHOLE body until the stream naturally closes (`reader.read()`
 * reports `done`), racing a `timeoutMs` sentinel so a stream that never
 * closes fails this helper promptly and legibly — a clear assertion, not
 * vitest's default 5s/10s test/hook timeout (task 9 review, M-2: the
 * previous cross-tenant SSE test only proved *refusal*, reading one frame and
 * cancelling; it never pinned that the connection actually closes, which
 * `authorizeOnSubscribe: true` exists to guarantee for a denied caller — see
 * `builder.ts`'s doc comment, and the seen-to-fail run in the task 9 report
 * where, with that flag off, this exact scenario timed out instead of
 * closing).
 */
const readUntilClosed = async (
  body: ReadableStream<Uint8Array>,
  timeoutMs = 2000
): Promise<string> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const readToEnd = async (): Promise<string> => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return buffer;
      buffer += decoder.decode(value, { stream: true });
    }
  };
  const timeout = new Promise<string>((_resolve, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            `SSE stream did not close within ${timeoutMs}ms — buffer so far: ${JSON.stringify(buffer)}`
          )
        ),
      timeoutMs
    );
  });
  return Promise.race([readToEnd(), timeout]);
};

/**
 * Spec §"Auth and transport": "Transport is SSE on the existing `/graphql`
 * endpoint via `Accept: text/event-stream`." These are HTTP-level tests
 * (real Express app on a real listening port, real `fetch`) — the only layer
 * that can actually observe SSE framing, since `test-util.ts`'s `execute()`
 * goes through `graphql()` directly and the schema-level subscription tests
 * (`scan-progress.test.ts`) use `graphql`'s own `subscribe()`, neither of
 * which ever produces an HTTP response.
 */
describe('scanProgress over SSE', () => {
  it('delivers a live scanProgress event over HTTP as text/event-stream', async () => {
    const token = tokenFor(harness.aliceOwner.userId, 'alice', false);
    const controller = new AbortController();

    const responsePromise = fetch(`${baseUrl}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: SUBSCRIPTION,
        variables: { libraryId: aliceLibraryGlobalId },
      }),
      signal: controller.signal,
    });

    // Same real-timer tolerance `scan-progress.test.ts` uses: give the
    // request time to reach the server, authenticate, and register the
    // subscription's pubsub listener before the triggering store call fires.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = harness.scanJobs.start(harness.aliceOwner.userId);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const payload = (await firstSseEvent(response.body!)) as {
      data?: { scanProgress?: { id: string; state: string } };
    };
    expect(payload.data?.scanProgress?.id).toBe(started.jobId);
    expect(payload.data?.scanProgress?.state).toBe('RUNNING');

    controller.abort();
  });

  // Final-review-wave M-4: `graphqlBodyLimit` is mounted in exactly one
  // place, `server.ts:64` (`server.use('/graphql', graphqlBodyLimit(100 *
  // 1024), graphqlHandler)`) — every other SSE/content-negotiation/logging
  // test in this repo builds its own Express app WITHOUT that middleware.
  // The final review reasoned through and manually reproduced (200 +
  // `text/event-stream`, live event delivered) that the combination is
  // safe — this pins that reproduction as a committed regression test
  // instead of leaving it as an unrepeated manual check. Reasoning: the
  // subscription transport here is a POST with `Accept: text/event-stream`
  // and a JSON body, so `fetch` sets `Content-Length` and never touches the
  // 411 (missing-Content-Length) arm; a small SSE-subscribe request body is
  // nowhere near the 100kb cap either.
  it('delivers a live scanProgress event over SSE THROUGH graphqlBodyLimit, mounted in the same order as server.ts (M-4)', async () => {
    const bodyLimitedApp = express();
    bodyLimitedApp.use(
      '/graphql',
      graphqlBodyLimit(100 * 1024),
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
    const bodyLimitedServer = bodyLimitedApp.listen(0);
    await new Promise<void>((resolve) => bodyLimitedServer.once('listening', resolve));
    const bodyLimitedBaseUrl = `http://127.0.0.1:${(bodyLimitedServer.address() as AddressInfo).port}`;

    try {
      const token = tokenFor(harness.aliceOwner.userId, 'alice', false);
      const controller = new AbortController();
      const body = JSON.stringify({
        query: SUBSCRIPTION,
        variables: { libraryId: aliceLibraryGlobalId },
      });

      const responsePromise = fetch(`${bodyLimitedBaseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        body,
        signal: controller.signal,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      const started = harness.scanJobs.start(harness.aliceOwner.userId);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      const payload = (await firstSseEvent(response.body!)) as {
        data?: { scanProgress?: { id: string; state: string } };
      };
      expect(payload.data?.scanProgress?.id).toBe(started.jobId);
      expect(payload.data?.scanProgress?.state).toBe('RUNNING');

      controller.abort();
    } finally {
      await new Promise<void>((resolve) => bodyLimitedServer.close(() => resolve()));
    }
  });

  it('refuses a non-owner subscription — denied AND the connection closes promptly, no standing stream', async () => {
    const bobToken = tokenFor(harness.bobOwner.userId, 'bob', false);

    const response = await fetch(`${baseUrl}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({
        query: SUBSCRIPTION,
        variables: { libraryId: aliceLibraryGlobalId },
      }),
    });

    // A subscribe-time auth failure (`authorizeOnSubscribe: true`,
    // `builder.ts`) is a single `ExecutionResult`, not a live stream — the
    // SSE processor (`graphql-yoga`'s `getSSEProcessor`) frames that
    // identically to a live event: one `event: next` carrying the error,
    // immediately followed by `event: complete`, then the stream ends. Read
    // the WHOLE body (not just the first frame) so this pins CLOSURE, not
    // merely refusal — `readUntilClosed` fails this test directly if the
    // stream stays open, rather than that only showing up as vitest's
    // generic hook-timeout failure later.
    const buffer = await readUntilClosed(response.body!);
    expect(buffer).toContain('event: complete');

    const dataLine = buffer.split('\n').find((line) => line.startsWith('data: {'));
    if (dataLine === undefined) throw new Error(`no error data: line in SSE body: ${buffer}`);
    const payload = JSON.parse(dataLine.slice('data: '.length)) as {
      errors?: { extensions?: { code?: string } }[];
    };
    expect(payload.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

    // Victim state unchanged — the denied attempt started no job for alice.
    expect(harness.scanJobs.get(harness.aliceOwner.userId)).toBeUndefined();
  });
});

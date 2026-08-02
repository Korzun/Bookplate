import * as http from 'http';
import type { AddressInfo } from 'net';

import express from 'express';

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
    scanProgress(libraryId: $libraryId) { jobId state }
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
      stores: harness.stores,
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
    const started = harness.stores.scanJob.start(harness.aliceOwner.userId);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const payload = (await firstSseEvent(response.body!)) as {
      data?: { scanProgress?: { jobId: string; state: string } };
    };
    expect(payload.data?.scanProgress?.jobId).toBe(started.jobId);
    expect(payload.data?.scanProgress?.state).toBe('RUNNING');

    controller.abort();
  });

  it('refuses a non-owner subscription — denied in the very first SSE frame, no live event ever sent', async () => {
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
    // immediately followed by `event: complete`.
    const payload = (await firstSseEvent(response.body!)) as {
      errors?: { extensions?: { code?: string } }[];
    };
    expect(payload.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

    // Victim state unchanged — the denied attempt started no job for alice.
    expect(harness.stores.scanJob.get(harness.aliceOwner.userId)).toBeUndefined();
  });
});

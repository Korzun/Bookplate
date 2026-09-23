import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';
import webpush from 'web-push';

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import type { NotificationPayload, NotificationRecipient } from './notification';
import {
  createPushChannelDriver,
  SEND_TIMEOUT_MS,
  TTL_SECONDS,
  type PushSender,
} from './notification-channel-push';
import { listPushSubscriptionRows, upsertPushSubscription } from './push-subscription';

vi.mock('../logger');
// Mocked so the ONE test below that drives the driver's default,
// non-injected `send` closure (every other test in this file injects a fake
// `send` and never touches this module) can assert on the real
// `webpush.sendNotification` call — its argument shape and options — without
// a network or a real push service.
vi.mock('web-push', () => ({
  default: {
    sendNotification: vi.fn(),
  },
}));

let tmpDir: string;
let prisma: PrismaClient;
const ALICE = 'user-alice';
const NOW = 9_000;

const VAPID = { publicKey: 'pub', privateKey: 'priv' };

const recipient: NotificationRecipient = {
  userId: ALICE,
  email: 'alice@example.com',
  emailVerifiedAt: 1,
};

const payload: NotificationPayload = {
  requesterUsername: 'alice',
  title: 'Dune',
  author: 'Frank Herbert',
  note: '',
  declineReason: '',
};

const driverWith = (send: PushSender) =>
  createPushChannelDriver({
    prisma,
    vapid: VAPID,
    contact: 'mailto:admin@example.com',
    libraryName: 'Bookplate',
    now: () => NOW,
    send,
  });

const deliver = (send: PushSender) =>
  driverWith(send).deliver({ recipient, event: 'book_request.fulfilled', payload });

const subscribe = (endpoint: string) =>
  upsertPushSubscription(prisma, {
    userId: ALICE,
    endpoint,
    p256dh: 'key',
    auth: 'secret',
    label: 'Chrome',
    now: 1,
  });

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-driver-'));
  const booksDir = path.join(tmpDir, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  await runMigrations(prisma, booksDir);
  await prisma.user.create({ data: { id: ALICE, username: 'alice' } });
});

afterEach(async () => {
  await prisma.$disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

it('reports no destination when the user has never subscribed', async () => {
  const send = vi.fn<PushSender>();

  // Not a failure: push is enabled-by-default, so a user with no browser
  // subscribed must not bank a buried outbox row per notification.
  expect(await deliver(send)).toEqual({ ok: false, reason: 'no_destination' });
  expect(send).not.toHaveBeenCalled();
});

it('delivers to every subscription and records each success', async () => {
  await subscribe('https://push.example/a');
  await subscribe('https://push.example/b');
  const send = vi.fn<PushSender>().mockResolvedValue({ statusCode: 201 });

  expect(await deliver(send)).toEqual({ ok: true });
  expect(send).toHaveBeenCalledTimes(2);

  const rows = await listPushSubscriptionRows(prisma, ALICE);
  expect(rows.map((r) => r.lastSuccessAt)).toEqual([NOW, NOW]);
});

it('sends the rendered template as the body', async () => {
  await subscribe('https://push.example/a');
  const send = vi.fn<PushSender>().mockResolvedValue({ statusCode: 201 });

  await deliver(send);

  const body = JSON.parse(send.mock.calls[0]![0].body) as Record<string, string>;
  expect(body.title).toBe('Dune was added to your library');
  expect(body.url).toBe('/add/request');
  expect(body.tag).toContain('book_request.fulfilled');
});

it('prunes a gone endpoint and still succeeds via the live one', async () => {
  await subscribe('https://push.example/dead');
  await subscribe('https://push.example/live');
  const send = vi.fn<PushSender>().mockImplementation(async ({ subscription }) => ({
    statusCode: subscription.endpoint.endsWith('dead') ? 410 : 201,
  }));

  expect(await deliver(send)).toEqual({ ok: true });

  const rows = await listPushSubscriptionRows(prisma, ALICE);
  expect(rows).toHaveLength(1);
});

it('reports no destination when every endpoint was gone', async () => {
  await subscribe('https://push.example/dead');
  const send = vi.fn<PushSender>().mockResolvedValue({ statusCode: 404 });

  expect(await deliver(send)).toEqual({ ok: false, reason: 'no_destination' });
  expect(await prisma.pushSubscription.count()).toBe(0);
});

it('does NOT delete a subscription on a 401', async () => {
  await subscribe('https://push.example/a');
  const send = vi.fn<PushSender>().mockResolvedValue({ statusCode: 401 });

  expect(await deliver(send)).toEqual({ ok: false, reason: 'misconfigured' });

  // The regression that would cost every user every device: 400/401/403/413
  // mean the SENDER is wrong, and deleting on them would let one bad VAPID
  // config wipe the install's subscriptions unrecoverably.
  expect(await prisma.pushSubscription.count()).toBe(1);
});

it('classifies throttling and server errors as retryable', async () => {
  await subscribe('https://push.example/a');

  expect(await deliver(vi.fn<PushSender>().mockResolvedValue({ statusCode: 429 }))).toEqual({
    ok: false,
    reason: 'throttled',
  });
  expect(await deliver(vi.fn<PushSender>().mockResolvedValue({ statusCode: 503 }))).toEqual({
    ok: false,
    reason: 'transient',
  });
  expect(await deliver(vi.fn<PushSender>().mockRejectedValue(new Error('ECONNRESET')))).toEqual({
    ok: false,
    reason: 'transient',
  });
});

it('prunes a subscription when a thrown error carries statusCode 410', async () => {
  // Drives the driver's own catch-block statusCode extraction directly: this
  // is the shape a caller-injected `send` (or a future `web-push` version)
  // could produce, and the driver must classify it exactly as it would a
  // resolved 410 — not fall through to `transient` and leak the endpoint.
  await subscribe('https://push.example/a');
  const send = vi
    .fn<PushSender>()
    .mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));

  expect(await deliver(send)).toEqual({ ok: false, reason: 'no_destination' });
  expect(await prisma.pushSubscription.count()).toBe(0);
});

it('does NOT delete a subscription when a thrown error carries statusCode 401', async () => {
  await subscribe('https://push.example/a');
  const send = vi
    .fn<PushSender>()
    .mockRejectedValue(Object.assign(new Error('bad request'), { statusCode: 401 }));

  expect(await deliver(send)).toEqual({ ok: false, reason: 'misconfigured' });
  expect(await prisma.pushSubscription.count()).toBe(1);
});

it('lets a transient failure outrank a success so the row retries', async () => {
  await subscribe('https://push.example/ok');
  await subscribe('https://push.example/flaky');
  const send = vi.fn<PushSender>().mockImplementation(async ({ subscription }) => ({
    statusCode: subscription.endpoint.endsWith('flaky') ? 503 : 201,
  }));

  // Re-pushing to the device that already worked is the accepted cost — the
  // template's `tag` makes the duplicate replace rather than stack — and it
  // buys never losing the other device's notification.
  expect(await deliver(send)).toEqual({ ok: false, reason: 'transient' });
});

it(
  'does not hang the drain when an endpoint completes the handshake and then never responds ' +
    '(I-2: `deliver()` must resolve, not wedge `NotificationQueue.drainOnce`/`poke()` forever)',
  async () => {
    await subscribe('https://push.example/hangs');
    // A `send` that never settles at all — the shape a TLS-connected but
    // silent endpoint produces, since `web-push` gives this driver no
    // per-request abort hook to fall back on (see `SEND_TIMEOUT_MS`'s own
    // doc comment). Fake timers, not a real 10s wait: `vi.advanceTimersByTimeAsync`
    // fast-forwards the `withTimeout` race's own timer without the test
    // actually waiting out the deadline.
    const send = vi.fn<PushSender>().mockReturnValue(new Promise<never>(() => {}));
    vi.useFakeTimers();
    try {
      const result = deliver(send);
      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
      // `transient`, not a hang and not a thrown error out of `deliver`
      // itself: a timeout is retryable, exactly like the ECONNRESET case
      // above, and the outbox row gets another attempt rather than being
      // silently dropped or wedging every other user's notifications behind
      // it.
      expect(await result).toEqual({ ok: false, reason: 'transient' });
    } finally {
      vi.useRealTimers();
    }
  }
);

it('lets a success outrank a misconfiguration', async () => {
  await subscribe('https://push.example/ok');
  await subscribe('https://push.example/bad');
  const send = vi.fn<PushSender>().mockImplementation(async ({ subscription }) => ({
    statusCode: subscription.endpoint.endsWith('bad') ? 400 : 201,
  }));

  // Ordered below success because the causes are install-wide by construction
  // (same keys, same payload to every endpoint), so this pairing cannot really
  // happen — and ordering it here means a partial success is never buried.
  expect(await deliver(send)).toEqual({ ok: true });
});

describe('the default send (no injected `send`)', () => {
  // Every `it` above injects a fake `send`, so the real closure — the one
  // that actually calls `webpush.sendNotification` in production — was
  // exercised by nothing until this. It closes that gap: is the option
  // object right, and does `contact` round-trip as the VAPID subject.
  const driverWithDefaultSend = () =>
    createPushChannelDriver({
      prisma,
      vapid: VAPID,
      contact: 'mailto:admin@example.com',
      libraryName: 'Bookplate',
      now: () => NOW,
      // No `send` passed: the driver falls back to its own
      // `webpush.sendNotification`-calling closure.
    });

  const deliverWithDefaultSend = () =>
    driverWithDefaultSend().deliver({ recipient, event: 'book_request.fulfilled', payload });

  beforeEach(() => {
    vi.mocked(webpush.sendNotification).mockReset();
  });

  it('calls webpush.sendNotification with the subscription, TTL/urgency and VAPID details', async () => {
    await subscribe('https://push.example/a');
    vi.mocked(webpush.sendNotification).mockResolvedValue({
      statusCode: 201,
      body: '',
      headers: {},
    });

    expect(await deliverWithDefaultSend()).toEqual({ ok: true });
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);

    const [subscriptionArg, , options] = vi.mocked(webpush.sendNotification).mock.calls[0]!;
    expect(subscriptionArg).toEqual({
      endpoint: 'https://push.example/a',
      keys: { p256dh: 'key', auth: 'secret' },
    });
    expect(options).toMatchObject({
      TTL: TTL_SECONDS,
      urgency: 'normal',
      vapidDetails: {
        subject: 'mailto:admin@example.com',
        publicKey: VAPID.publicKey,
        privateKey: VAPID.privateKey,
      },
    });
  });

  it('normalizes a rejected 410 from webpush.sendNotification and prunes the subscription', async () => {
    // `web-push` REJECTS for any non-2xx response rather than resolving with
    // it — a `WebPushError` carrying `.statusCode` — so this is the shape
    // production actually sees, not an edge case. The driver's own catch
    // block must normalize it back into a resolved status and prune.
    await subscribe('https://push.example/a');
    vi.mocked(webpush.sendNotification).mockRejectedValue(
      Object.assign(new Error('Gone'), { statusCode: 410 })
    );

    expect(await deliverWithDefaultSend()).toEqual({ ok: false, reason: 'no_destination' });
    expect(await prisma.pushSubscription.count()).toBe(0);
  });
});

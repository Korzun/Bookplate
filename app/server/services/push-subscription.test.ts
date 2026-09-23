import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import {
  deletePushSubscription,
  deletePushSubscriptionByEndpoint,
  listPushSubscriptionRows,
  listPushSubscriptionsForUser,
  markPushSubscriptionDelivered,
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  upsertPushSubscription,
} from './push-subscription';

vi.mock('../logger');

let tmpDir: string;
let prisma: PrismaClient;
const ALICE = 'user-alice';
const BOB = 'user-bob';
const ENDPOINT = 'https://push.example/endpoint-1';

/**
 * Every OTHER test in this file expects the subscribe to succeed (well under
 * `MAX_PUSH_SUBSCRIPTIONS_PER_USER`), so this asserts that instead of letting
 * callers destructure a possibly-`null` result — a genuine `null` here means
 * the test itself hit the cap unexpectedly, which is a test bug worth failing
 * loudly on rather than a `TypeError` on the destructure. The cap's OWN tests,
 * below, call `upsertPushSubscription` directly to observe the `null`.
 */
const subscribe = async (userId: string, endpoint = ENDPOINT, label = 'Chrome on macOS') => {
  const result = await upsertPushSubscription(prisma, {
    userId,
    endpoint,
    p256dh: 'key',
    auth: 'secret',
    label,
    now: 1000,
  });
  if (result === null) throw new Error('expected upsertPushSubscription to succeed');
  return result;
};

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-sub-'));
  const booksDir = path.join(tmpDir, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  await runMigrations(prisma, booksDir);
  await prisma.user.create({ data: { id: ALICE, username: 'alice' } });
  await prisma.user.create({ data: { id: BOB, username: 'bob' } });
});

afterEach(async () => {
  await prisma.$disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

it('stores a subscription and lists it back with its keys', async () => {
  const { id } = await subscribe(ALICE);

  const live = await listPushSubscriptionsForUser(prisma, ALICE);
  expect(live).toEqual([{ id, endpoint: ENDPOINT, p256dh: 'key', auth: 'secret' }]);
});

it('re-subscribing the same browser updates rather than duplicates', async () => {
  const first = await subscribe(ALICE);
  const second = await subscribe(ALICE);

  expect(second.id).toBe(first.id);
  expect(await prisma.pushSubscription.count()).toBe(1);
});

it('re-binds an endpoint that arrives under a second account', async () => {
  await subscribe(ALICE);
  await subscribe(BOB);

  // A browser holds ONE subscription per origin, so the same endpoint under a
  // second account means the browser changed hands. Two rows would deliver
  // alice's notifications to whoever is signed in as bob.
  expect(await prisma.pushSubscription.count()).toBe(1);
  expect(await listPushSubscriptionsForUser(prisma, ALICE)).toEqual([]);
  expect(await listPushSubscriptionsForUser(prisma, BOB)).toHaveLength(1);
});

it("refuses to delete another account's subscription", async () => {
  const { id } = await subscribe(ALICE);

  expect(await deletePushSubscription(prisma, { userId: BOB, id })).toBe(false);
  expect(await prisma.pushSubscription.count()).toBe(1);

  expect(await deletePushSubscription(prisma, { userId: ALICE, id })).toBe(true);
  expect(await prisma.pushSubscription.count()).toBe(0);
});

it('deletes by endpoint, and tolerates an endpoint already gone', async () => {
  await subscribe(ALICE);

  await deletePushSubscriptionByEndpoint(prisma, ENDPOINT);
  expect(await prisma.pushSubscription.count()).toBe(0);

  // The driver prunes concurrently with a user removing a device; a second
  // delete must not throw.
  await expect(deletePushSubscriptionByEndpoint(prisma, ENDPOINT)).resolves.toBeUndefined();
});

it('records a delivery timestamp only when told to', async () => {
  const { id } = await subscribe(ALICE);

  const before = await listPushSubscriptionRows(prisma, ALICE);
  expect(before[0]?.lastSuccessAt).toBeNull();

  await markPushSubscriptionDelivered(prisma, { id, now: 5000 });

  const after = await listPushSubscriptionRows(prisma, ALICE);
  expect(after[0]).toMatchObject({
    label: 'Chrome on macOS',
    createdAt: 1000,
    lastSuccessAt: 5000,
  });
});

it("re-subscribing does not clear a device's delivery history", async () => {
  // A device that keeps working across a re-sync has not stopped working: if
  // the upsert ever reset lastSuccessAt, a healthy device would start reading
  // "never received a notification" in the user's device list.
  const { id } = await subscribe(ALICE);
  await markPushSubscriptionDelivered(prisma, { id, now: 5000 });

  await upsertPushSubscription(prisma, {
    userId: ALICE,
    endpoint: ENDPOINT,
    p256dh: 'new-key',
    auth: 'new-secret',
    label: 'Chrome on macOS (updated)',
    now: 9000,
  });

  const rows = await listPushSubscriptionRows(prisma, ALICE);
  expect(rows[0]?.lastSuccessAt).toBe(5000);
});

describe('the per-user cap (I-3, 3b)', () => {
  it('refuses a NEW device once the user is already at MAX_PUSH_SUBSCRIPTIONS_PER_USER', async () => {
    for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS_PER_USER; i++) {
      await subscribe(ALICE, `https://push.example/device-${i}`);
    }
    expect(await prisma.pushSubscription.count()).toBe(MAX_PUSH_SUBSCRIPTIONS_PER_USER);

    // Refused, not evicting the oldest: a silent eviction would stop
    // notifying a device its owner never touched and never asked to remove.
    const result = await upsertPushSubscription(prisma, {
      userId: ALICE,
      endpoint: 'https://push.example/one-too-many',
      p256dh: 'key',
      auth: 'secret',
      label: 'Chrome',
      now: 2000,
    });

    expect(result).toBeNull();
    expect(await prisma.pushSubscription.count()).toBe(MAX_PUSH_SUBSCRIPTIONS_PER_USER);
  });

  it('still allows re-subscribing an ALREADY-known endpoint at the cap — re-subscribing is not a new device', async () => {
    for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS_PER_USER; i++) {
      await subscribe(ALICE, `https://push.example/device-${i}`);
    }

    // Same endpoint as `device-0`, fresh keys — the exact shape a browser's
    // routine re-sync produces (`upsertPushSubscription`'s own doc comment).
    const result = await upsertPushSubscription(prisma, {
      userId: ALICE,
      endpoint: 'https://push.example/device-0',
      p256dh: 'rotated-key',
      auth: 'rotated-secret',
      label: 'Chrome (rotated)',
      now: 2000,
    });

    expect(result).not.toBeNull();
    expect(await prisma.pushSubscription.count()).toBe(MAX_PUSH_SUBSCRIPTIONS_PER_USER);
    const rows = await listPushSubscriptionsForUser(prisma, ALICE);
    expect(rows.find((r) => r.endpoint === 'https://push.example/device-0')).toMatchObject({
      p256dh: 'rotated-key',
      auth: 'rotated-secret',
    });
  });

  it("does not count toward a DIFFERENT user's cap", async () => {
    for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS_PER_USER; i++) {
      await subscribe(ALICE, `https://push.example/alice-${i}`);
    }

    const result = await upsertPushSubscription(prisma, {
      userId: BOB,
      endpoint: 'https://push.example/bob-0',
      p256dh: 'key',
      auth: 'secret',
      label: 'Chrome',
      now: 2000,
    });

    expect(result).not.toBeNull();
  });
});

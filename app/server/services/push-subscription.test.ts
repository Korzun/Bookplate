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
  upsertPushSubscription,
} from './push-subscription';

vi.mock('../logger');

let tmpDir: string;
let prisma: PrismaClient;
const ALICE = 'user-alice';
const BOB = 'user-bob';
const ENDPOINT = 'https://push.example/endpoint-1';

const subscribe = (userId: string, endpoint = ENDPOINT, label = 'Chrome on macOS') =>
  upsertPushSubscription(prisma, {
    userId,
    endpoint,
    p256dh: 'key',
    auth: 'secret',
    label,
    now: 1000,
  });

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

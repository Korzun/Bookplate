import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import type { SendResult } from './mailer';
import { enqueueNotification, type ChannelDriver, type NotificationPayload } from './notification';
import {
  BACKOFF_MS,
  BATCH_SIZE,
  MAX_ATTEMPTS,
  NotificationQueue,
  RETENTION_MS,
} from './notification-queue';

vi.mock('../logger');

let tmpDir: string;
let prisma: PrismaClient;
const ALICE = 'user-alice';
const NOW = 1_000_000;

const payload: NotificationPayload = {
  requesterUsername: 'alice',
  title: 'Dune',
  author: 'Frank Herbert',
  note: '',
  declineReason: '',
};

type StubDriver = ChannelDriver & { calls: number; nextResult: SendResult };

const stubDriver = (): StubDriver => ({
  calls: 0,
  nextResult: { ok: true },
  async deliver(): Promise<SendResult> {
    this.calls += 1;
    return this.nextResult;
  },
});

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notification-queue-'));
  const booksDir = path.join(tmpDir, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  await runMigrations(prisma, booksDir);
  await prisma.user.create({
    data: { id: ALICE, username: 'alice', email: 'alice@example.com', emailVerifiedAt: 1 },
  });
});

afterEach(async () => {
  await prisma.$disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const enqueue = () =>
  enqueueNotification(prisma, {
    event: 'book_request.fulfilled',
    subjectUserId: ALICE,
    payload,
    now: NOW,
  });

const queueWith = (driver: ChannelDriver | undefined, now = NOW) =>
  new NotificationQueue({
    prisma,
    drivers: driver === undefined ? {} : { email: driver },
    now: () => now,
  });

const onlyRow = async () => {
  const rows = await prisma.notificationOutbox.findMany();
  expect(rows).toHaveLength(1);
  return rows[0];
};

describe('NotificationQueue.drainOnce', () => {
  it('delivers a due row and marks it sent', async () => {
    await enqueue();
    const driver = stubDriver();

    await queueWith(driver).drainOnce();

    expect(driver.calls).toBe(1);
    expect((await onlyRow()).sentAt).toBe(NOW);
  });

  it('hands the driver the recipient row, not just an id', async () => {
    await enqueue();
    const seen: unknown[] = [];
    const driver: ChannelDriver = {
      async deliver(args) {
        seen.push(args.recipient);
        return { ok: true };
      },
    };

    await queueWith(driver).drainOnce();

    expect(seen).toEqual([{ userId: ALICE, email: 'alice@example.com', emailVerifiedAt: 1 }]);
  });

  it('leaves a row whose nextAttemptAt is in the future alone', async () => {
    await enqueue();
    await prisma.notificationOutbox.updateMany({ data: { nextAttemptAt: NOW + 1 } });
    const driver = stubDriver();

    await queueWith(driver).drainOnce();

    expect(driver.calls).toBe(0);
    expect((await onlyRow()).sentAt).toBeNull();
  });

  it('gives up permanently on invalid_destination', async () => {
    await enqueue();
    const driver = stubDriver();
    driver.nextResult = { ok: false, reason: 'invalid_destination' };

    await queueWith(driver).drainOnce();

    const row = await onlyRow();
    expect(row.failedAt).toBe(NOW);
    expect(row.attempts).toBe(0);
    expect(row.lastError).toContain('invalid_destination');
  });

  it('gives up permanently on misconfigured', async () => {
    await enqueue();
    const driver = stubDriver();
    driver.nextResult = { ok: false, reason: 'misconfigured' };

    await queueWith(driver).drainOnce();

    expect((await onlyRow()).failedAt).toBe(NOW);
  });

  it('backs off a transient failure on the published schedule', async () => {
    await enqueue();
    const driver = stubDriver();
    driver.nextResult = { ok: false, reason: 'transient' };

    await queueWith(driver).drainOnce();

    const row = await onlyRow();
    expect(row.attempts).toBe(1);
    expect(row.failedAt).toBeNull();
    expect(row.nextAttemptAt).toBe(NOW + BACKOFF_MS[0]);
  });

  it('gives up after MAX_ATTEMPTS transient failures', async () => {
    await enqueue();
    await prisma.notificationOutbox.updateMany({ data: { attempts: MAX_ATTEMPTS - 1 } });
    const driver = stubDriver();
    driver.nextResult = { ok: false, reason: 'throttled' };

    await queueWith(driver).drainOnce();

    const row = await onlyRow();
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.failedAt).toBe(NOW);
  });

  it('reaches the last backoff tier before the row goes terminal', async () => {
    await enqueue();
    const driver = stubDriver();
    driver.nextResult = { ok: false, reason: 'transient' };

    // Drive the row through every tier of BACKOFF_MS, advancing the injected
    // clock to each row's own nextAttemptAt so it comes due again. This pins
    // the property the un-derived MAX_ATTEMPTS/BACKOFF_MS pair got wrong: the
    // LAST tier (the 10-hour wait) must actually be reached, not just the
    // first four.
    let now = NOW;
    for (let i = 0; i < BACKOFF_MS.length; i++) {
      await queueWith(driver, now).drainOnce();
      const row = await onlyRow();
      expect(row.attempts).toBe(i + 1);
      expect(row.failedAt).toBeNull();
      expect(row.nextAttemptAt).toBe(now + BACKOFF_MS[i]);
      now = row.nextAttemptAt;
    }

    // One more failure exhausts the cap, at the last tier's wait rather than
    // stopping short of it.
    await queueWith(driver, now).drainOnce();
    const finalRow = await onlyRow();
    expect(finalRow.attempts).toBe(MAX_ATTEMPTS);
    expect(finalRow.failedAt).toBe(now);
  });

  it('isolates a row whose delivery throws so a healthy row behind it still delivers', async () => {
    await enqueue();
    // Created after the poison row (later createdAt) but already due (its
    // own nextAttemptAt is NOW), so both are in the same `due` batch with the
    // poison row first.
    await prisma.notificationOutbox.create({
      data: {
        id: 'healthy',
        userId: ALICE,
        event: 'book_request.fulfilled',
        channel: 'email',
        payload: JSON.stringify(payload),
        nextAttemptAt: NOW,
        createdAt: NOW + 1,
      },
    });

    let calls = 0;
    const driver: ChannelDriver = {
      async deliver() {
        calls += 1;
        if (calls === 1) throw new Error('boom: malformed payload');
        return { ok: true };
      },
    };

    await queueWith(driver).drainOnce();

    const rows = await prisma.notificationOutbox.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(calls).toBe(2);

    const [poison, healthy] = rows;
    expect(poison.attempts).toBe(1);
    expect(poison.failedAt).toBeNull();
    expect(poison.nextAttemptAt).toBe(NOW + BACKOFF_MS[0]);
    expect(poison.lastError).toContain('boom: malformed payload');

    expect(healthy.attempts).toBe(0);
    expect(healthy.sentAt).toBe(NOW);
  });

  it('discards a row whose channel has no driver', async () => {
    await enqueue();

    await queueWith(undefined).drainOnce();

    expect(await prisma.notificationOutbox.count()).toBe(0);
  });

  it('discards a row whose recipient no longer exists', async () => {
    await enqueue();

    // The outbox has an `onDelete: Cascade` FK to `users`, so a row can never
    // actually outlive its recipient through Prisma — deleting the user takes
    // the outbox row with it. That makes this state unreachable in normal
    // operation. We fabricate it anyway (disable enforcement, delete the user
    // while the row survives, re-enable enforcement) because the drain must
    // not crash if it ever sees an orphaned row by surprise; this test exists
    // to pin that defensive branch, not to model a real code path.
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
    await prisma.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" = '${ALICE}'`);
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');

    const driver = stubDriver();

    await queueWith(driver).drainOnce();

    expect(driver.calls).toBe(0);
    expect(await prisma.notificationOutbox.count()).toBe(0);
  });

  it('does not schedule a redelivery when a successful send fails to persist', async () => {
    // Pins the fix for the duplicate-send defect: `driver.deliver()` succeeds
    // (the mail is out) but the `sentAt` write that records it throws. The
    // row must NOT come out of this looking like a failed delivery — no
    // bumped `attempts`, no `nextAttemptAt` pushed into the future by
    // `retry()` — because that would schedule a mail that already sent to go
    // out again. (The row's `sentAt` itself is unavoidably still null here:
    // that write is exactly what failed. What this test pins is that the
    // catch path does not ALSO route the row through backoff on top of that.)
    await enqueue();
    const driver = stubDriver();

    vi.spyOn(prisma.notificationOutbox, 'update').mockRejectedValueOnce(
      new Error('db exploded persisting sentAt')
    );

    await queueWith(driver).drainOnce();

    expect(driver.calls).toBe(1);
    const row = await onlyRow();
    expect(row.attempts).toBe(0);
    expect(row.failedAt).toBeNull();
    expect(row.nextAttemptAt).toBe(NOW);
  });

  it('prunes settled rows older than the retention window and keeps fresh ones', async () => {
    await enqueue();
    await prisma.notificationOutbox.updateMany({ data: { sentAt: NOW - RETENTION_MS - 1 } });
    await prisma.notificationOutbox.create({
      data: {
        id: 'fresh',
        userId: ALICE,
        event: 'book_request.declined',
        channel: 'email',
        payload: JSON.stringify(payload),
        nextAttemptAt: NOW,
        createdAt: NOW,
        failedAt: NOW,
      },
    });

    await queueWith(stubDriver()).drainOnce();

    const ids = (await prisma.notificationOutbox.findMany({ select: { id: true } })).map(
      (r) => r.id
    );
    expect(ids).toEqual(['fresh']);
  });
});

describe('NotificationQueue lifecycle', () => {
  it('drains on poke and settles awaitIdle', async () => {
    await enqueue();
    const driver = stubDriver();
    const queue = queueWith(driver);

    queue.poke();
    await queue.awaitIdle();

    expect(driver.calls).toBe(1);
    expect((await onlyRow()).sentAt).toBe(NOW);
  });

  it('awaitIdle resolves immediately when nothing is running', async () => {
    await expect(queueWith(stubDriver()).awaitIdle()).resolves.toBeUndefined();
  });

  it('drains a backlog bigger than one batch in a single poke, not one BATCH_SIZE bite per tick', async () => {
    const total = BATCH_SIZE * 2 + 5;
    await prisma.notificationOutbox.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        id: `row-${i}`,
        userId: ALICE,
        event: 'book_request.fulfilled',
        channel: 'email',
        payload: JSON.stringify(payload),
        nextAttemptAt: NOW,
        createdAt: NOW + i,
      })),
    });
    const driver = stubDriver();
    const queue = queueWith(driver);

    queue.poke();
    await queue.awaitIdle();

    expect(driver.calls).toBe(total);
    expect(await prisma.notificationOutbox.count({ where: { sentAt: NOW } })).toBe(total);
  });
});

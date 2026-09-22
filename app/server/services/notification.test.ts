import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import {
  enqueueNotification,
  eventsForRole,
  isNotificationEnabled,
  listNotificationPreferences,
  NOTIFICATION_CHANNELS,
  parsePayload,
  setNotificationPreference,
  type NotificationPayload,
} from './notification';

vi.mock('../logger');

let tmpDir: string;
let prisma: PrismaClient;
const ALICE = 'user-alice';
const ADMIN = 'user-admin';

const payload = (overrides: Partial<NotificationPayload> = {}): NotificationPayload => ({
  requesterUsername: 'alice',
  title: 'Dune',
  author: 'Frank Herbert',
  note: '',
  declineReason: '',
  ...overrides,
});

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notification-'));
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

const makeAdmin = () =>
  prisma.user.create({ data: { id: ADMIN, username: 'admin', isConfigAdmin: true } });

describe('isNotificationEnabled', () => {
  it('treats an absent row as enabled', async () => {
    const enabled = await isNotificationEnabled(prisma, {
      userId: ALICE,
      event: 'book_request.fulfilled',
      channel: 'email',
    });
    expect(enabled).toBe(true);
  });

  it('honours a stored opt-out', async () => {
    await setNotificationPreference(prisma, {
      userId: ALICE,
      event: 'book_request.fulfilled',
      channel: 'email',
      enabled: false,
    });
    const enabled = await isNotificationEnabled(prisma, {
      userId: ALICE,
      event: 'book_request.fulfilled',
      channel: 'email',
    });
    expect(enabled).toBe(false);
  });

  it('scopes a stored row to its own event', async () => {
    await setNotificationPreference(prisma, {
      userId: ALICE,
      event: 'book_request.fulfilled',
      channel: 'email',
      enabled: false,
    });
    const other = await isNotificationEnabled(prisma, {
      userId: ALICE,
      event: 'book_request.declined',
      channel: 'email',
    });
    expect(other).toBe(true);
  });
});

describe('setNotificationPreference', () => {
  it('upserts rather than duplicating, so re-enabling is idempotent', async () => {
    const args = {
      userId: ALICE,
      event: 'book_request.declined' as const,
      channel: 'email' as const,
    };
    await setNotificationPreference(prisma, { ...args, enabled: false });
    await setNotificationPreference(prisma, { ...args, enabled: true });
    await setNotificationPreference(prisma, { ...args, enabled: true });

    expect(await prisma.notificationPreference.count()).toBe(1);
    expect(await isNotificationEnabled(prisma, args)).toBe(true);
  });
});

describe('eventsForRole', () => {
  it('gives the admin only the created event', () => {
    expect(eventsForRole('admin')).toEqual(['book_request.created']);
  });

  it('gives a reader only the two outcome events', () => {
    expect(eventsForRole('reader')).toEqual(['book_request.fulfilled', 'book_request.declined']);
  });
});

describe('listNotificationPreferences', () => {
  it('returns the role’s whole catalogue with defaults merged over stored rows', async () => {
    await setNotificationPreference(prisma, {
      userId: ALICE,
      event: 'book_request.declined',
      channel: 'email',
      enabled: false,
    });

    const rows = await listNotificationPreferences(prisma, {
      userId: ALICE,
      role: 'reader',
      channels: NOTIFICATION_CHANNELS,
    });

    expect(rows).toEqual([
      { event: 'book_request.fulfilled', channel: 'email', enabled: true },
      { event: 'book_request.declined', channel: 'email', enabled: false },
    ]);
  });

  it('returns nothing when no channel is configured', async () => {
    const rows = await listNotificationPreferences(prisma, {
      userId: ALICE,
      role: 'reader',
      channels: [],
    });
    expect(rows).toEqual([]);
  });
});

describe('enqueueNotification', () => {
  it('routes a subject-audience event to the subject', async () => {
    await enqueueNotification(prisma, {
      event: 'book_request.fulfilled',
      subjectUserId: ALICE,
      payload: payload(),
      now: 1000,
    });

    const rows = await prisma.notificationOutbox.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: ALICE,
      event: 'book_request.fulfilled',
      channel: 'email',
      attempts: 0,
      nextAttemptAt: 1000,
      createdAt: 1000,
      sentAt: null,
      failedAt: null,
    });
    expect(parsePayload(rows[0].payload)).toEqual(payload());
  });

  it('routes an admin-audience event to the config admin, not the subject', async () => {
    await makeAdmin();

    await enqueueNotification(prisma, {
      event: 'book_request.created',
      subjectUserId: ALICE,
      payload: payload(),
    });

    const rows = await prisma.notificationOutbox.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ADMIN);
  });

  it('enqueues nothing when there is no admin row', async () => {
    await enqueueNotification(prisma, {
      event: 'book_request.created',
      subjectUserId: ALICE,
      payload: payload(),
    });
    expect(await prisma.notificationOutbox.count()).toBe(0);
  });

  it('enqueues nothing for a muted event', async () => {
    await setNotificationPreference(prisma, {
      userId: ALICE,
      event: 'book_request.fulfilled',
      channel: 'email',
      enabled: false,
    });

    await enqueueNotification(prisma, {
      event: 'book_request.fulfilled',
      subjectUserId: ALICE,
      payload: payload(),
    });
    expect(await prisma.notificationOutbox.count()).toBe(0);
  });

  it('is rolled back with the transaction that wrote it', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueueNotification(tx, {
          event: 'book_request.fulfilled',
          subjectUserId: ALICE,
          payload: payload(),
        });
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(await prisma.notificationOutbox.count()).toBe(0);
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { DeviceStore, DeviceSlugConflictError } from './device-store';

vi.mock('../logger');

let prisma: PrismaClient;
let dbPath: string;
let store: DeviceStore;

beforeEach(async () => {
  const booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-'));
  dbPath = path.join(
    os.tmpdir(),
    `dev-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
  store = new DeviceStore(prisma);
});
afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {}
});

const base = {
  coverWidth: null,
  coverHeight: null,
  coverFit: 'contain' as const,
  bwCover: false,
  simplify: false,
};

it('creates a device with a generated slug', async () => {
  const d = await store.create({ name: 'Kindle PW', ...base });
  expect(d.slug).toBe('kindle-pw');
  expect(await store.list()).toHaveLength(1);
  expect(await store.getBySlug('kindle-pw')).not.toBeNull();
});

it('updates settings and regenerates slug on rename', async () => {
  const d = await store.create({ name: 'Kindle', ...base });
  const updated = await store.update(d.id, { name: 'Kobo', ...base, simplify: true });
  expect(updated?.slug).toBe('kobo');
  expect(updated?.simplify).toBe(true);
});

it('deletes a device', async () => {
  const d = await store.create({ name: 'Boox', ...base });
  expect(await store.delete(d.id)).toBe(true);
  expect(await store.getById(d.id)).toBeNull();
});

it('returns null when updating a device that no longer exists', async () => {
  expect(await store.update('missing', { name: 'Kobo', ...base })).toBeNull();
});

it('returns false when deleting a device that no longer exists', async () => {
  expect(await store.delete('missing')).toBe(false);
});

it('throws DeviceSlugConflictError when a create collides on slug', async () => {
  await store.create({ name: 'Kindle', ...base });
  await expect(store.create({ name: 'Kindle', ...base })).rejects.toBeInstanceOf(
    DeviceSlugConflictError
  );
});

describe('device-user enablement', () => {
  async function makeUser(id: string, username: string) {
    await prisma.user.create({ data: { id, username } });
  }

  it('enableUser adds a row and isEnabled reflects it; disableUser removes it', async () => {
    const device = await store.create({ name: 'Kindle', ...base });
    await makeUser('u1', 'alice');

    expect(await store.isEnabled(device.id, 'u1')).toBe(false);
    await store.enableUser(device.id, 'u1');
    expect(await store.isEnabled(device.id, 'u1')).toBe(true);

    await store.disableUser(device.id, 'u1');
    expect(await store.isEnabled(device.id, 'u1')).toBe(false);
  });

  it('enableUser is idempotent (no unique-constraint crash on repeat)', async () => {
    const device = await store.create({ name: 'Kindle', ...base });
    await makeUser('u1', 'alice');
    await store.enableUser(device.id, 'u1');
    await store.enableUser(device.id, 'u1');
    expect(await store.listUsernamesForDevice(device.id)).toEqual(['alice']);
  });

  it('disableUser is idempotent (no crash when not enabled)', async () => {
    const device = await store.create({ name: 'Kindle', ...base });
    await makeUser('u1', 'alice');
    await expect(store.disableUser(device.id, 'u1')).resolves.toBeUndefined();
  });

  it('listUsernamesForDevice returns enabled usernames sorted', async () => {
    const device = await store.create({ name: 'Kindle', ...base });
    await makeUser('u1', 'bob');
    await makeUser('u2', 'alice');
    await store.enableUser(device.id, 'u1');
    await store.enableUser(device.id, 'u2');
    expect(await store.listUsernamesForDevice(device.id)).toEqual(['alice', 'bob']);
  });

  it('listForUser returns only devices enabled for that user, sorted by name', async () => {
    const kindle = await store.create({ name: 'Kindle', ...base });
    const kobo = await store.create({ name: 'Kobo', ...base });
    await store.create({ name: 'Nook', ...base }); // not enabled for anyone
    await makeUser('u1', 'alice');
    await store.enableUser(kobo.id, 'u1');
    await store.enableUser(kindle.id, 'u1');

    const devices = await store.listForUser('u1');
    expect(devices.map((d) => d.name)).toEqual(['Kindle', 'Kobo']);
  });

  it('deleting a device cascades its device_users rows', async () => {
    const device = await store.create({ name: 'Kindle', ...base });
    await makeUser('u1', 'alice');
    await store.enableUser(device.id, 'u1');
    await store.delete(device.id);
    expect(await prisma.deviceUser.count()).toBe(0);
  });

  it('deleting a user cascades its device_users rows', async () => {
    const device = await store.create({ name: 'Kindle', ...base });
    await makeUser('u1', 'alice');
    await store.enableUser(device.id, 'u1');
    await prisma.user.delete({ where: { id: 'u1' } });
    expect(await prisma.deviceUser.count()).toBe(0);
  });
});

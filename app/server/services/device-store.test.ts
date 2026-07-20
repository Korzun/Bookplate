import fs from 'fs';
import os from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
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

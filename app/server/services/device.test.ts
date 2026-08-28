import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { getBySlug, isEnabled } from './device';

vi.mock('../logger');

let prisma: PrismaClient;
let dbPath: string;

beforeEach(async () => {
  const booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-'));
  dbPath = path.join(
    os.tmpdir(),
    `dev-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
});

afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {}
});

describe('getBySlug', () => {
  it('returns the device for a known slug', async () => {
    await prisma.device.create({ data: { id: 'dev-1', name: 'Kindle PW', slug: 'kindle-pw' } });
    expect(await getBySlug(prisma, 'kindle-pw')).not.toBeNull();
  });

  it('returns null for an unknown slug', async () => {
    expect(await getBySlug(prisma, 'no-such-slug')).toBeNull();
  });
});

describe('isEnabled', () => {
  async function makeUser(id: string, username: string) {
    await prisma.user.create({ data: { id, username } });
  }

  it('reflects enablement: false before enabling, true after, false after disabling', async () => {
    await prisma.device.create({ data: { id: 'dev-1', name: 'Kindle', slug: 'kindle' } });
    await makeUser('u1', 'alice');

    expect(await isEnabled(prisma, 'dev-1', 'u1')).toBe(false);

    await prisma.deviceUser.create({ data: { deviceId: 'dev-1', userId: 'u1' } });
    expect(await isEnabled(prisma, 'dev-1', 'u1')).toBe(true);

    await prisma.deviceUser.deleteMany({ where: { deviceId: 'dev-1', userId: 'u1' } });
    expect(await isEnabled(prisma, 'dev-1', 'u1')).toBe(false);
  });

  it('returns false after the enabled user is deleted (cascade)', async () => {
    await prisma.device.create({ data: { id: 'dev-1', name: 'Kindle', slug: 'kindle' } });
    await makeUser('u1', 'alice');
    await prisma.deviceUser.create({ data: { deviceId: 'dev-1', userId: 'u1' } });
    expect(await isEnabled(prisma, 'dev-1', 'u1')).toBe(true);

    await prisma.user.delete({ where: { id: 'u1' } });

    expect(await prisma.deviceUser.count()).toBe(0);
    expect(await isEnabled(prisma, 'dev-1', 'u1')).toBe(false);
  });
});

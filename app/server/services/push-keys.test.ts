import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import { getOrCreateVapidKeys } from './push-keys';

vi.mock('../logger');

let tmpDir: string;
let prisma: PrismaClient;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-keys-'));
  const booksDir = path.join(tmpDir, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  await runMigrations(prisma, booksDir);
});

afterEach(async () => {
  await prisma.$disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

it('generates a usable keypair on first call', async () => {
  const keys = await getOrCreateVapidKeys(prisma);

  // A P-256 public point, base64url, is 65 raw bytes -> 87 characters.
  expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
  expect(keys.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

it('returns the same pair on a second call', async () => {
  const first = await getOrCreateVapidKeys(prisma);
  const second = await getOrCreateVapidKeys(prisma);

  expect(second).toEqual(first);
});

it('converges on one pair when two first boots race', async () => {
  const [a, b] = await Promise.all([getOrCreateVapidKeys(prisma), getOrCreateVapidKeys(prisma)]);

  expect(a).toEqual(b);
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['vapid_public_key', 'vapid_private_key'] } },
  });
  expect(rows).toHaveLength(2);
});

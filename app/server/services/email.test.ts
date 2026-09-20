import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, afterEach } from 'vitest';

import { runMigrations } from '../db/migrate';
import {
  findUserByEmail,
  isValidEmail,
  markEmailVerified,
  normalizeEmail,
  setUserEmail,
} from './email';

vi.mock('../logger');

let prisma: PrismaClient;
let dbPath: string;

beforeEach(async () => {
  const booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-'));
  dbPath = path.join(
    os.tmpdir(),
    `email-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
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

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ann.Reader@Example.COM ')).toBe('ann.reader@example.com');
  });
});

describe('isValidEmail', () => {
  it.each(['a@b.co', 'ann.reader+tag@sub.example.com', "o'brien@example.org"])(
    'accepts %s',
    (value) => expect(isValidEmail(value)).toBe(true)
  );

  it.each([
    '',
    'ann',
    'ann@',
    '@example.com',
    'ann@example',
    'a b@example.com',
    'ann@@example.com',
  ])('rejects %s', (value) => expect(isValidEmail(value)).toBe(false));

  it('rejects an address long enough to be abusive', () => {
    expect(isValidEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });
});

describe('setUserEmail', () => {
  beforeEach(async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
    await prisma.user.create({ data: { id: 'u2', username: 'bob' } });
  });

  it('stores the address as entered and the key normalized', async () => {
    expect(await setUserEmail(prisma, 'u1', ' Ann@Example.com ')).toEqual({ ok: true });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } });
    expect(row.email).toBe('Ann@Example.com');
    expect(row.emailKey).toBe('ann@example.com');
  });

  it('leaves the new address unverified', async () => {
    await setUserEmail(prisma, 'u1', 'ann@example.com');
    await markEmailVerified(prisma, 'u1');
    await setUserEmail(prisma, 'u1', 'other@example.com');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } });
    expect(row.emailVerifiedAt).toBeNull();
  });

  it('rejects a malformed address', async () => {
    expect(await setUserEmail(prisma, 'u1', 'nope')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('reports a collision as an outcome rather than throwing', async () => {
    await setUserEmail(prisma, 'u1', 'shared@example.com');
    expect(await setUserEmail(prisma, 'u2', 'SHARED@example.com')).toEqual({
      ok: false,
      reason: 'in_use',
    });
  });

  it('lets a user re-set their own address', async () => {
    await setUserEmail(prisma, 'u1', 'ann@example.com');
    expect(await setUserEmail(prisma, 'u1', 'ann@example.com')).toEqual({ ok: true });
  });
});

describe('findUserByEmail', () => {
  beforeEach(async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
    await setUserEmail(prisma, 'u1', 'Ann@Example.com');
  });

  it('matches regardless of case or surrounding space', async () => {
    expect(await findUserByEmail(prisma, ' ANN@example.COM ')).toMatchObject({
      id: 'u1',
      username: 'ann',
      isConfigAdmin: false,
    });
  });

  it('returns null for an unknown address', async () => {
    expect(await findUserByEmail(prisma, 'nobody@example.com')).toBeNull();
  });

  it('returns null rather than scanning for a malformed value', async () => {
    expect(await findUserByEmail(prisma, 'not-an-address')).toBeNull();
  });
});

describe('markEmailVerified', () => {
  it('records when, not merely whether', async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
    await setUserEmail(prisma, 'u1', 'ann@example.com');
    await markEmailVerified(prisma, 'u1', 1_700_000_000_000);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } });
    expect(row.emailVerifiedAt).toBe(1_700_000_000_000);
  });
});

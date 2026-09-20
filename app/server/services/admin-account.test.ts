import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import type { Mock } from 'vitest';

import { runMigrations } from '../db/migrate';
import { logger } from '../logger';
import { ensureAdminUser, isConfigAdminRow, NOT_CONFIG_ADMIN } from './admin-account';

vi.mock('../logger');

/**
 * Same pattern `yoga-operation-logging.test.ts` uses: `logger(namespace)` is
 * itself a mocked `vi.fn()` that returns a fresh spy object per call, so the
 * only way to reach `services/admin-account.ts`'s own `log` is to find the
 * call that produced it. Captured once, at module load — `admin-account.ts`'s
 * own `logger('AdminAccount')` call happens exactly once (module caching),
 * the first time it's imported, which is BEFORE `vite.config.ts`'s
 * `mockReset: true` clears call history ahead of the first test. Calling this
 * lazily inside a test would find nothing, since the call it looks for never
 * happens again.
 */
const adminAccountLoggerSpies = (): { warn: Mock; error: Mock } => {
  const mocked = vi.mocked(logger);
  const index = mocked.mock.calls.findIndex(([namespace]) => namespace === 'AdminAccount');
  if (index === -1) throw new Error("logger('AdminAccount') was never called");
  return mocked.mock.results[index]?.value as { warn: Mock; error: Mock };
};
const adminAccountLog = adminAccountLoggerSpies();

let prisma: PrismaClient;
let dbPath: string;

beforeEach(async () => {
  const booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-account-'));
  dbPath = path.join(
    os.tmpdir(),
    `admin-account-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
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

describe('ensureAdminUser', () => {
  it('creates the row with no credentials of its own', async () => {
    const id = await ensureAdminUser(prisma, 'admin');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: id! } });
    expect(row.username).toBe('admin');
    expect(row.isConfigAdmin).toBe(true);
    // The add-on options are the only credential. A hash here would be a second
    // one, and a sync password would hand the admin OPDS/KOSync access it has
    // never had.
    expect(row.passwordHash).toBeNull();
    expect(row.syncPassword).toBeNull();
  });

  it('is idempotent across restarts', async () => {
    const first = await ensureAdminUser(prisma, 'admin');
    const second = await ensureAdminUser(prisma, 'admin');
    expect(second).toBe(first);
    expect(await prisma.user.count()).toBe(1);
  });

  it('renames the existing row when the options username changes', async () => {
    const id = await ensureAdminUser(prisma, 'admin');
    await prisma.user.update({ where: { id: id! }, data: { email: 'a@b.co', emailKey: 'a@b.co' } });

    const after = await ensureAdminUser(prisma, 'librarian');

    expect(after).toBe(id);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: id! } });
    expect(row.username).toBe('librarian');
    // The whole point of renaming rather than re-creating.
    expect(row.email).toBe('a@b.co');
    expect(await prisma.user.count()).toBe(1);
  });

  it('leaves the row alone when the new username is taken', async () => {
    const id: string | null = await ensureAdminUser(prisma, 'admin');
    await prisma.user.create({ data: { id: 'u2', username: 'librarian' } });

    const after = await ensureAdminUser(prisma, 'librarian');

    expect(after).toBe(id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: id! } })).username).toBe('admin');
  });

  // C1 (critical, whole-branch review): the old behaviour here ADOPTED this
  // row and cleared its credentials — irreversibly destroying a real user's
  // argon2 hash and sync password if the collision was theirs (a reader who
  // happens to hold the admin's configured username, or an operator who
  // renamed `username` and upgraded in the same step). Refusing, like case 2's
  // blocked rename, is the only safe response: an operator can fix a naming
  // collision, but nobody can recover a destroyed credential.
  it('refuses to adopt a legacy row bearing the admin username, leaving its credentials untouched', async () => {
    await prisma.user.create({
      data: {
        id: 'legacy',
        username: 'admin',
        passwordHash: 'argon2-hash',
        syncPassword: 'blue oak',
      },
    });

    const id = await ensureAdminUser(prisma, 'admin');

    expect(id).toBeNull();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: 'legacy' } });
    // Falsifiable: reverting the guard (restoring the old adopt-and-clear
    // branch) makes every assertion below fail — `isConfigAdmin` becomes
    // true and both credentials become null.
    expect(row.isConfigAdmin).toBe(false);
    expect(row.passwordHash).toBe('argon2-hash');
    expect(row.syncPassword).toBe('blue oak');
    expect(await prisma.user.count()).toBe(1);
    expect(adminAccountLog.error).toHaveBeenCalledWith(expect.stringContaining('admin'));
  });
});

describe('isConfigAdminRow', () => {
  it('is true for the admin row and false for a reader', async () => {
    const adminId = await ensureAdminUser(prisma, 'admin');
    await prisma.user.create({ data: { id: 'u2', username: 'bob' } });
    expect(await isConfigAdminRow(prisma, adminId!)).toBe(true);
    expect(await isConfigAdminRow(prisma, 'u2')).toBe(false);
  });

  it('is false for an unknown id', async () => {
    expect(await isConfigAdminRow(prisma, 'nope')).toBe(false);
  });
});

describe('NOT_CONFIG_ADMIN', () => {
  it('filters the admin row out of a listing', async () => {
    await ensureAdminUser(prisma, 'admin');
    await prisma.user.create({ data: { id: 'u2', username: 'bob' } });
    const rows = await prisma.user.findMany({ where: NOT_CONFIG_ADMIN });
    expect(rows.map((r) => r.username)).toEqual(['bob']);
  });
});

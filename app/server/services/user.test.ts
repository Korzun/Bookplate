import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { purgeForUser } from './edition';
import { getSyncPassword, hashLoginPassword } from './password';
import { saveProgress } from './progress';
import { createUser, deleteUser } from './user';

vi.mock('../logger');
// Call-through by default (see edition.test.ts's identical pattern) so every
// test that doesn't care about the edition purge still exercises the real
// `purgeForUser` — only the two tests below that assert on the purge itself
// stub it, via `mockImplementationOnce`/`mockRejectedValueOnce`.
vi.mock('./edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./edition')>()),
  purgeForUser: vi.fn((await importOriginal<typeof import('./edition')>()).purgeForUser),
}));

let prisma: PrismaClient;
let dbPath: string;
let editionsRoot: string;

beforeEach(async () => {
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, os.tmpdir());
  editionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'user-editions-'));
});

afterEach(async () => {
  // restoreAllMocks() only reverts vi.spyOn()-created spies; `purgeForUser`
  // above is a module-mocked vi.fn() with a call-through default and no
  // "original" to restore to, so its call history survives restoreAllMocks
  // alone — clear it explicitly too (see edition.test.ts's identical note).
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
});

describe('createUser', () => {
  it('creates a user and returns true', async () => {
    const hash = await hashLoginPassword('pass');
    expect(await createUser(prisma, 'alice', hash)).toBe(true);
  });

  it('creates a user with null passwordHash', async () => {
    expect(await createUser(prisma, 'nopass', null)).toBe(true);
  });

  it('returns false for duplicate username', async () => {
    const hash = await hashLoginPassword('pass');
    await createUser(prisma, 'alice', hash);
    expect(await createUser(prisma, 'alice', hash)).toBe(false);
  });

  it('auto-generates syncPassword if not provided', async () => {
    await createUser(prisma, 'alice', null);
    const syncPwd = await getSyncPassword(prisma, 'alice');
    expect(syncPwd).not.toBeNull();
    expect(syncPwd!.split(' ')).toHaveLength(2);
  });

  it('assigns a unique 21-char alphanumeric ID to each user', async () => {
    await createUser(prisma, 'alice', 'k1');
    await createUser(prisma, 'bob', 'k2');
    const alice = await prisma.user.findUnique({ where: { username: 'alice' } });
    const bob = await prisma.user.findUnique({ where: { username: 'bob' } });
    expect(alice!.id).toMatch(/^[A-Za-z0-9]{21}$/);
    expect(bob!.id).toMatch(/^[A-Za-z0-9]{21}$/);
    expect(alice!.id).not.toBe(bob!.id);
  });
});

describe('deleteUser', () => {
  let aliceId: string;

  beforeEach(async () => {
    await createUser(prisma, 'alice', null);
    aliceId = (await prisma.user.findUnique({ where: { username: 'alice' } }))!.id;
    await saveProgress(prisma, aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
  });

  it('returns false for unknown user', async () => {
    expect(await deleteUser(prisma, editionsRoot, 'nobody')).toBe(false);
  });

  it('returns true and removes the user', async () => {
    expect(await deleteUser(prisma, editionsRoot, 'alice')).toBe(true);
    expect(await prisma.user.findUnique({ where: { username: 'alice' } })).toBeNull();
  });

  it('cascades to delete all progress records', async () => {
    await deleteUser(prisma, editionsRoot, 'alice');
    expect(await prisma.progress.findMany({ where: { userId: aliceId } })).toEqual([]);
  });

  it('does not affect other users', async () => {
    await createUser(prisma, 'bob', null);
    await deleteUser(prisma, editionsRoot, 'alice');
    expect(await prisma.user.findUnique({ where: { username: 'bob' } })).not.toBeNull();
  });

  it('invokes the edition purge with the deleted userId', async () => {
    vi.mocked(purgeForUser).mockResolvedValueOnce(undefined);
    await createUser(prisma, 'carol', null);
    const carolId = (await prisma.user.findUnique({ where: { username: 'carol' } }))!.id;

    expect(await deleteUser(prisma, editionsRoot, 'carol')).toBe(true);
    // `expect.anything()` for the leading `prisma` arg, not the real
    // instance: a deep-equal match against a PrismaClient's circular
    // internal structure overflows the assertion's own call stack.
    expect(purgeForUser).toHaveBeenCalledWith(expect.anything(), editionsRoot, carolId);
  });

  it('still succeeds when the edition purge throws', async () => {
    vi.mocked(purgeForUser).mockRejectedValueOnce(new Error('purge boom'));
    await createUser(prisma, 'dave', null);

    expect(await deleteUser(prisma, editionsRoot, 'dave')).toBe(true);
    expect(await prisma.user.findUnique({ where: { username: 'dave' } })).toBeNull();
    expect(purgeForUser).toHaveBeenCalled();
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { purgeForUser } from './edition';
import { getSyncPassword, hashLoginPassword, resetPassword } from './password';
import { saveProgress } from './progress';
import { UserStore } from './user-store';

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
let store: UserStore;
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
  editionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'user-store-editions-'));
  store = new UserStore(prisma, editionsRoot);
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

describe('UserStore.createUser', () => {
  it('creates a user and returns true', async () => {
    const hash = await hashLoginPassword('pass');
    expect(await store.createUser('alice', hash)).toBe(true);
  });

  it('creates a user with null passwordHash', async () => {
    expect(await store.createUser('nopass', null)).toBe(true);
  });

  it('returns false for duplicate username', async () => {
    const hash = await hashLoginPassword('pass');
    await store.createUser('alice', hash);
    expect(await store.createUser('alice', hash)).toBe(false);
  });

  it('auto-generates syncPassword if not provided', async () => {
    await store.createUser('alice', null);
    const syncPwd = await getSyncPassword(prisma, 'alice');
    expect(syncPwd).not.toBeNull();
    expect(syncPwd!.split(' ')).toHaveLength(2);
  });

  it('assigns a unique 21-char alphanumeric ID to each user', async () => {
    await store.createUser('alice', 'k1');
    await store.createUser('bob', 'k2');
    const alice = await prisma.user.findUnique({ where: { username: 'alice' } });
    const bob = await prisma.user.findUnique({ where: { username: 'bob' } });
    expect(alice!.id).toMatch(/^[A-Za-z0-9]{21}$/);
    expect(bob!.id).toMatch(/^[A-Za-z0-9]{21}$/);
    expect(alice!.id).not.toBe(bob!.id);
  });
});

describe('UserStore.getMustChangePassword', () => {
  it('returns false by default', async () => {
    await store.createUser('alice', null);
    expect(await store.getMustChangePassword('alice')).toBe(false);
  });

  it('returns true after resetPassword', async () => {
    await store.createUser('alice', null);
    await resetPassword(prisma, 'alice');
    expect(await store.getMustChangePassword('alice')).toBe(true);
  });

  it('returns false for unknown user', async () => {
    expect(await store.getMustChangePassword('nobody')).toBe(false);
  });
});

describe('UserStore.userExists', () => {
  it('returns false for unknown user', async () => {
    expect(await store.userExists('nobody')).toBe(false);
  });

  it('returns true for a registered user', async () => {
    await store.createUser('alice', null);
    expect(await store.userExists('alice')).toBe(true);
  });
});

describe('UserStore.listUsers', () => {
  it('returns empty array when no users', async () => {
    expect(await store.listUsers()).toEqual([]);
  });

  it('returns users sorted by username with progress count', async () => {
    await store.createUser('zara', null);
    await store.createUser('alice', null);
    const aliceId = (await store.getUserIdByUsername('alice'))!;
    await saveProgress(prisma, aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    await saveProgress(prisma, aliceId, {
      document: 'doc2',
      progress: '/p[1]',
      percentage: 0.2,
      device: 'Kobo',
      device_id: 'd1',
    });
    const users = await store.listUsers();
    expect(users).toHaveLength(2);
    expect(users[0].username).toBe('alice');
    expect(users[0].progressCount).toBe(2);
    expect(users[1].username).toBe('zara');
    expect(users[1].progressCount).toBe(0);
  });
});

describe('UserStore.deleteUser', () => {
  let aliceId: string;

  beforeEach(async () => {
    await store.createUser('alice', null);
    aliceId = (await store.getUserIdByUsername('alice'))!;
    await saveProgress(prisma, aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
  });

  it('returns false for unknown user', async () => {
    expect(await store.deleteUser('nobody')).toBe(false);
  });

  it('returns true and removes the user', async () => {
    expect(await store.deleteUser('alice')).toBe(true);
    expect(await store.userExists('alice')).toBe(false);
  });

  it('cascades to delete all progress records', async () => {
    await store.deleteUser('alice');
    expect(await prisma.progress.findMany({ where: { userId: aliceId } })).toEqual([]);
  });

  it('does not affect other users', async () => {
    await store.createUser('bob', null);
    await store.deleteUser('alice');
    expect(await store.userExists('bob')).toBe(true);
  });

  it('invokes the edition purge with the deleted userId', async () => {
    vi.mocked(purgeForUser).mockResolvedValueOnce(undefined);
    await store.createUser('carol', null);
    const carolId = (await store.getUserIdByUsername('carol'))!;

    expect(await store.deleteUser('carol')).toBe(true);
    // `expect.anything()` for the leading `prisma` arg, not the real
    // instance: a deep-equal match against a PrismaClient's circular
    // internal structure overflows the assertion's own call stack.
    expect(purgeForUser).toHaveBeenCalledWith(expect.anything(), editionsRoot, carolId);
  });

  it('still succeeds when the edition purge throws', async () => {
    vi.mocked(purgeForUser).mockRejectedValueOnce(new Error('purge boom'));
    await store.createUser('dave', null);

    expect(await store.deleteUser('dave')).toBe(true);
    expect(await store.userExists('dave')).toBe(false);
    expect(purgeForUser).toHaveBeenCalled();
  });
});

describe('UserStore.getUserIdByUsername', () => {
  it('returns null for unknown user', async () => {
    expect(await store.getUserIdByUsername('nobody')).toBeNull();
  });

  it('returns the user ID for a known user', async () => {
    await store.createUser('alice', null);
    const id = await store.getUserIdByUsername('alice');
    expect(id).toMatch(/^[A-Za-z0-9]{21}$/);
  });

  it('returns consistent ID across calls', async () => {
    await store.createUser('alice', null);
    const id1 = await store.getUserIdByUsername('alice');
    const id2 = await store.getUserIdByUsername('alice');
    expect(id1).toBe(id2);
  });
});

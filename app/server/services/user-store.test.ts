import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { purgeForUser } from './edition';
import { getSyncPassword, hashLoginPassword, resetPassword } from './password';
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

describe('UserStore.saveProgress + getProgress', () => {
  let aliceId: string;

  beforeEach(async () => {
    await store.createUser('alice', null);
    aliceId = (await store.getUserIdByUsername('alice'))!;
  });

  it('retrieves saved progress', async () => {
    await store.saveProgress(aliceId, {
      document: 'abc123',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
    });
    const p = await store.getProgress(aliceId, 'abc123');
    expect(p).not.toBeNull();
    expect(p!.progress).toBe('/body/DocFragment[5]');
    expect(p!.percentage).toBeCloseTo(0.42);
  });

  it('updates existing progress on conflict', async () => {
    await store.saveProgress(aliceId, {
      document: 'abc123',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
    });
    await store.saveProgress(aliceId, {
      document: 'abc123',
      progress: '/body/DocFragment[10]',
      percentage: 0.8,
      device: 'Kobo',
      device_id: 'dev-1',
    });
    const p = await store.getProgress(aliceId, 'abc123');
    expect(p!.percentage).toBeCloseTo(0.8);
  });

  it('returns null when no progress exists', async () => {
    expect(await store.getProgress(aliceId, 'unknown')).toBeNull();
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
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    await store.saveProgress(aliceId, {
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
    await store.saveProgress(aliceId, {
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

describe('UserStore.clearProgress', () => {
  let aliceId: string;
  let bobId: string;

  beforeEach(async () => {
    await store.createUser('alice', null);
    await store.createUser('bob', null);
    aliceId = (await store.getUserIdByUsername('alice'))!;
    bobId = (await store.getUserIdByUsername('bob'))!;
  });

  it('returns false when no record exists', async () => {
    expect(await store.clearProgress(aliceId, 'doc1')).toBe(false);
  });

  it('deletes an existing record and returns true', async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    expect(await store.clearProgress(aliceId, 'doc1')).toBe(true);
    expect(await store.getProgress(aliceId, 'doc1')).toBeNull();
  });

  it("does not affect another user's progress for the same document", async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    await store.saveProgress(bobId, {
      document: 'doc1',
      progress: '/p[2]',
      percentage: 0.7,
      device: 'Kobo',
      device_id: 'd2',
    });
    await store.clearProgress(aliceId, 'doc1');
    expect(await store.getProgress(bobId, 'doc1')).not.toBeNull();
  });
});

describe('UserStore.saveProgress — history', () => {
  let aliceId: string;

  beforeEach(async () => {
    await store.createUser('alice', null);
    aliceId = (await store.getUserIdByUsername('alice'))!;
  });

  it('inserts a new history row with matching start and end timestamps on first sync', async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    const rows = await prisma.progressHistory.findMany({ where: { userId: aliceId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].startTimestamp).toBe(1000);
    expect(rows[0].endTimestamp).toBe(1000);
  });

  it('extends endTimestamp when same position + device syncs within 10 minutes', async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1599, // 599 s later — within 10 min
    });
    const rows = await prisma.progressHistory.findMany({ where: { userId: aliceId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].startTimestamp).toBe(1000);
    expect(rows[0].endTimestamp).toBe(1599);
  });

  it('inserts a new row when same position + device syncs after 10 minutes', async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1601, // 601 s later — past 10 min
    });
    const rows = await prisma.progressHistory.findMany({
      where: { userId: aliceId },
      orderBy: { startTimestamp: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].endTimestamp).toBe(1000);
    expect(rows[1].startTimestamp).toBe(1601);
    expect(rows[1].endTimestamp).toBe(1601);
  });

  it('inserts a new row when position changes', async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[6]',
      percentage: 0.45,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1100,
    });
    const rows = await prisma.progressHistory.findMany({
      where: { userId: aliceId },
      orderBy: { startTimestamp: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].progress).toBe('/body/DocFragment[5]');
    expect(rows[1].progress).toBe('/body/DocFragment[6]');
  });

  it('inserts a new row when same position is synced from a different device', async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kindle',
      device_id: 'dev-2',
      timestamp: 1100,
    });
    const rows = await prisma.progressHistory.findMany({ where: { userId: aliceId } });
    expect(rows).toHaveLength(2);
  });

  it('does not delete history when clearProgress is called', async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await store.clearProgress(aliceId, 'doc1');
    const rows = await prisma.progressHistory.findMany({ where: { userId: aliceId } });
    expect(rows).toHaveLength(1);
  });

  it('cascades to delete history when user is deleted', async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await store.deleteUser('alice');
    const rows = await prisma.progressHistory.findMany({ where: { userId: aliceId } });
    expect(rows).toHaveLength(0);
  });

  it('inserts a new row when a stale timestamp is earlier than the existing endTimestamp', async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 500, // stale — earlier than existing endTimestamp
    });
    const rows = await prisma.progressHistory.findMany({
      where: { userId: aliceId },
      orderBy: { startTimestamp: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].startTimestamp).toBe(500); // stale row recorded at its own timestamp
    expect(rows[0].endTimestamp).toBe(500);
    expect(rows[1].startTimestamp).toBe(1000); // original row untouched
    expect(rows[1].endTimestamp).toBe(1000);
  });

  it('does not throw and still saves current progress when history write fails', async () => {
    vi.spyOn(prisma.progressHistory, 'findFirst').mockRejectedValueOnce(
      new Error('simulated DB failure')
    );

    const result = await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });

    expect(result.percentage).toBeCloseTo(0.42);
    const current = await store.getProgress(aliceId, 'doc1');
    expect(current).not.toBeNull();
    expect(current!.percentage).toBeCloseTo(0.42);
  });
});

describe('UserStore.getUserProgressPage', () => {
  async function seed(userId: string, document: string, timestamp: number): Promise<void> {
    await prisma.progress.create({
      data: {
        userId,
        document,
        progress: `/p/${document}`,
        percentage: 0.5,
        device: 'Kobo',
        deviceId: 'd1',
        timestamp,
      },
    });
  }

  it('returns an empty page with null cursor when there is no progress', async () => {
    await store.createUser('alice', 'pass');
    const id = (await store.getUserIdByUsername('alice'))!;
    const page = await store.getUserProgressPage(id, null, 50);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('orders by timestamp desc, document asc and maps fields', async () => {
    await store.createUser('alice', 'pass');
    const id = (await store.getUserIdByUsername('alice'))!;
    await seed(id, 'a', 100);
    await seed(id, 'b', 200);
    const page = await store.getUserProgressPage(id, null, 50);
    expect(page.items.map((i) => i.document)).toEqual(['b', 'a']);
    expect(page.items[0]).toMatchObject({
      document: 'b',
      progress: '/p/b',
      device: 'Kobo',
      device_id: 'd1',
      timestamp: 200,
    });
    expect(page.nextCursor).toBeNull();
  });

  it('returns a nextCursor when more rows exist and advances past them', async () => {
    await store.createUser('alice', 'pass');
    const id = (await store.getUserIdByUsername('alice'))!;
    await seed(id, 'a', 100);
    await seed(id, 'b', 200);
    await seed(id, 'c', 300);
    const page1 = await store.getUserProgressPage(id, null, 2);
    expect(page1.items.map((i) => i.document)).toEqual(['c', 'b']);
    expect(page1.nextCursor).not.toBeNull();

    const cursor = JSON.parse(
      Buffer.from(page1.nextCursor as string, 'base64').toString('utf-8')
    ) as { timestamp: number; document: string };
    const page2 = await store.getUserProgressPage(id, cursor, 2);
    expect(page2.items.map((i) => i.document)).toEqual(['a']);
    expect(page2.nextCursor).toBeNull();
  });

  it('only returns rows for the specified user', async () => {
    await store.createUser('alice', 'pass');
    await store.createUser('bob', 'pass');
    const id = (await store.getUserIdByUsername('alice'))!;
    const bobId = (await store.getUserIdByUsername('bob'))!;
    await seed(id, 'doc1', 100);
    await seed(bobId, 'doc2', 200);
    const page = await store.getUserProgressPage(id, null, 50);
    expect(page.items.map((i) => i.document)).toEqual(['doc1']);
  });

  it('breaks timestamp ties by document ascending', async () => {
    await store.createUser('alice', 'pass');
    const id = (await store.getUserIdByUsername('alice'))!;
    await seed(id, 'y', 100);
    await seed(id, 'x', 100);
    const page1 = await store.getUserProgressPage(id, null, 1);
    expect(page1.items.map((i) => i.document)).toEqual(['x']); // same ts, 'x' < 'y'
    const cursor = JSON.parse(
      Buffer.from(page1.nextCursor as string, 'base64').toString('utf-8')
    ) as { timestamp: number; document: string };
    const page2 = await store.getUserProgressPage(id, cursor, 1);
    expect(page2.items.map((i) => i.document)).toEqual(['y']);
  });
});

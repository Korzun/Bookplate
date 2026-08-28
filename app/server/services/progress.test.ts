import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { clearProgress, getProgress, getUserProgressPage, saveProgress } from './progress';
import { createUser, deleteUser } from './user';

vi.mock('../logger');

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
  editionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-editions-'));
});

/** Test-fixture helper — not production code, so not subject to the
 * placement rule's caller-count clause. Replaces `UserStore.
 * getUserIdByUsername`, dissolved along with the rest of the class. */
async function getUserId(username: string): Promise<string> {
  const row = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  return row!.id;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
});

describe('saveProgress + getProgress', () => {
  let aliceId: string;

  beforeEach(async () => {
    await createUser(prisma, 'alice', null);
    aliceId = await getUserId('alice');
  });

  it('retrieves saved progress', async () => {
    await saveProgress(prisma, aliceId, {
      document: 'abc123',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
    });
    const p = await getProgress(prisma, aliceId, 'abc123');
    expect(p).not.toBeNull();
    expect(p!.progress).toBe('/body/DocFragment[5]');
    expect(p!.percentage).toBeCloseTo(0.42);
  });

  it('updates existing progress on conflict', async () => {
    await saveProgress(prisma, aliceId, {
      document: 'abc123',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
    });
    await saveProgress(prisma, aliceId, {
      document: 'abc123',
      progress: '/body/DocFragment[10]',
      percentage: 0.8,
      device: 'Kobo',
      device_id: 'dev-1',
    });
    const p = await getProgress(prisma, aliceId, 'abc123');
    expect(p!.percentage).toBeCloseTo(0.8);
  });

  it('returns null when no progress exists', async () => {
    expect(await getProgress(prisma, aliceId, 'unknown')).toBeNull();
  });
});

describe('clearProgress', () => {
  let aliceId: string;
  let bobId: string;

  beforeEach(async () => {
    await createUser(prisma, 'alice', null);
    await createUser(prisma, 'bob', null);
    aliceId = await getUserId('alice');
    bobId = await getUserId('bob');
  });

  it('returns false when no record exists', async () => {
    expect(await clearProgress(prisma, aliceId, 'doc1')).toBe(false);
  });

  it('deletes an existing record and returns true', async () => {
    await saveProgress(prisma, aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    expect(await clearProgress(prisma, aliceId, 'doc1')).toBe(true);
    expect(await getProgress(prisma, aliceId, 'doc1')).toBeNull();
  });

  it("does not affect another user's progress for the same document", async () => {
    await saveProgress(prisma, aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    await saveProgress(prisma, bobId, {
      document: 'doc1',
      progress: '/p[2]',
      percentage: 0.7,
      device: 'Kobo',
      device_id: 'd2',
    });
    await clearProgress(prisma, aliceId, 'doc1');
    expect(await getProgress(prisma, bobId, 'doc1')).not.toBeNull();
  });
});

describe('saveProgress — history', () => {
  let aliceId: string;

  beforeEach(async () => {
    await createUser(prisma, 'alice', null);
    aliceId = await getUserId('alice');
  });

  it('inserts a new history row with matching start and end timestamps on first sync', async () => {
    await saveProgress(prisma, aliceId, {
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
    await saveProgress(prisma, aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await saveProgress(prisma, aliceId, {
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
    await saveProgress(prisma, aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await saveProgress(prisma, aliceId, {
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
    await saveProgress(prisma, aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await saveProgress(prisma, aliceId, {
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
    await saveProgress(prisma, aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await saveProgress(prisma, aliceId, {
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
    await saveProgress(prisma, aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await clearProgress(prisma, aliceId, 'doc1');
    const rows = await prisma.progressHistory.findMany({ where: { userId: aliceId } });
    expect(rows).toHaveLength(1);
  });

  it('cascades to delete history when user is deleted', async () => {
    await saveProgress(prisma, aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await deleteUser(prisma, editionsRoot, 'alice');
    const rows = await prisma.progressHistory.findMany({ where: { userId: aliceId } });
    expect(rows).toHaveLength(0);
  });

  it('inserts a new row when a stale timestamp is earlier than the existing endTimestamp', async () => {
    await saveProgress(prisma, aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });
    await saveProgress(prisma, aliceId, {
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

    const result = await saveProgress(prisma, aliceId, {
      document: 'doc1',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
      timestamp: 1000,
    });

    expect(result.percentage).toBeCloseTo(0.42);
    const current = await getProgress(prisma, aliceId, 'doc1');
    expect(current).not.toBeNull();
    expect(current!.percentage).toBeCloseTo(0.42);
  });
});

describe('getUserProgressPage', () => {
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
    await createUser(prisma, 'alice', 'pass');
    const id = await getUserId('alice');
    const page = await getUserProgressPage(prisma, id, null, 50);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('orders by timestamp desc, document asc and maps fields', async () => {
    await createUser(prisma, 'alice', 'pass');
    const id = await getUserId('alice');
    await seed(id, 'a', 100);
    await seed(id, 'b', 200);
    const page = await getUserProgressPage(prisma, id, null, 50);
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
    await createUser(prisma, 'alice', 'pass');
    const id = await getUserId('alice');
    await seed(id, 'a', 100);
    await seed(id, 'b', 200);
    await seed(id, 'c', 300);
    const page1 = await getUserProgressPage(prisma, id, null, 2);
    expect(page1.items.map((i) => i.document)).toEqual(['c', 'b']);
    expect(page1.nextCursor).not.toBeNull();

    const cursor = JSON.parse(
      Buffer.from(page1.nextCursor as string, 'base64').toString('utf-8')
    ) as { timestamp: number; document: string };
    const page2 = await getUserProgressPage(prisma, id, cursor, 2);
    expect(page2.items.map((i) => i.document)).toEqual(['a']);
    expect(page2.nextCursor).toBeNull();
  });

  it('only returns rows for the specified user', async () => {
    await createUser(prisma, 'alice', 'pass');
    await createUser(prisma, 'bob', 'pass');
    const id = await getUserId('alice');
    const bobId = await getUserId('bob');
    await seed(id, 'doc1', 100);
    await seed(bobId, 'doc2', 200);
    const page = await getUserProgressPage(prisma, id, null, 50);
    expect(page.items.map((i) => i.document)).toEqual(['doc1']);
  });

  it('breaks timestamp ties by document ascending', async () => {
    await createUser(prisma, 'alice', 'pass');
    const id = await getUserId('alice');
    await seed(id, 'y', 100);
    await seed(id, 'x', 100);
    const page1 = await getUserProgressPage(prisma, id, null, 1);
    expect(page1.items.map((i) => i.document)).toEqual(['x']); // same ts, 'x' < 'y'
    const cursor = JSON.parse(
      Buffer.from(page1.nextCursor as string, 'base64').toString('utf-8')
    ) as { timestamp: number; document: string };
    const page2 = await getUserProgressPage(prisma, id, cursor, 1);
    expect(page2.items.map((i) => i.document)).toEqual(['y']);
  });
});

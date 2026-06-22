import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { UserStore } from './user-store';
import { runMigrations } from '../db/migrate';
import { WORDLIST } from './wordlist';

jest.mock('../logger');

let prisma: PrismaClient;
let store: UserStore;
let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, os.tmpdir());
  store = new UserStore(prisma);
});

afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
});

describe('UserStore.createUser', () => {
  it('creates a user and returns true', async () => {
    const hash = await UserStore.hashLoginPassword('pass');
    expect(await store.createUser('alice', hash)).toBe(true);
  });

  it('creates a user with null passwordHash', async () => {
    expect(await store.createUser('nopass', null)).toBe(true);
  });

  it('returns false for duplicate username', async () => {
    const hash = await UserStore.hashLoginPassword('pass');
    await store.createUser('alice', hash);
    expect(await store.createUser('alice', hash)).toBe(false);
  });

  it('auto-generates syncPassword if not provided', async () => {
    await store.createUser('alice', null);
    const syncPwd = await store.getSyncPassword('alice');
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

describe('UserStore.validateUser', () => {
  it('returns the user ID string for correct password', async () => {
    const hash = await UserStore.hashLoginPassword('mypass');
    await store.createUser('alice', hash);
    const result = await store.validateUser('alice', 'mypass');
    expect(result).toMatch(/^[A-Za-z0-9]{21}$/);
  });

  it('returns false for wrong password', async () => {
    const hash = await UserStore.hashLoginPassword('mypass');
    await store.createUser('alice', hash);
    expect(await store.validateUser('alice', 'wrong')).toBe(false);
  });

  it('returns false when passwordHash is null', async () => {
    await store.createUser('alice', null);
    expect(await store.validateUser('alice', 'anything')).toBe(false);
  });
});

describe('UserStore.userHasPassword', () => {
  it('returns true when passwordHash is set', async () => {
    const hash = await UserStore.hashLoginPassword('pw');
    await store.createUser('alice', hash);
    expect(await store.userHasPassword('alice')).toBe(true);
  });

  it('returns false when passwordHash is null', async () => {
    await store.createUser('alice', null);
    expect(await store.userHasPassword('alice')).toBe(false);
  });

  it('returns false for unknown user', async () => {
    expect(await store.userHasPassword('nobody')).toBe(false);
  });
});

describe('UserStore.changePassword', () => {
  it('updates passwordHash and allows login with new password', async () => {
    const oldHash = await UserStore.hashLoginPassword('old');
    await store.createUser('alice', oldHash);
    const newHash = await UserStore.hashLoginPassword('new');
    expect(await store.changePassword('alice', newHash)).toBe(true);
    expect(await store.validateUser('alice', 'new')).toBeTruthy();
    expect(await store.validateUser('alice', 'old')).toBe(false);
  });

  it('returns false for unknown user', async () => {
    expect(await store.changePassword('nobody', 'hash')).toBe(false);
  });

  it('clears mustChangePassword flag', async () => {
    await store.createUser('alice', null);
    await store.resetPassword('alice');
    expect(await store.getMustChangePassword('alice')).toBe(true);

    const newHash = await UserStore.hashLoginPassword('newpass');
    await store.changePassword('alice', newHash);

    expect(await store.getMustChangePassword('alice')).toBe(false);
  });
});

describe('UserStore.authenticateSync', () => {
  it('returns true when key equals MD5(syncPassword)', async () => {
    await store.createUser('alice', null);
    const syncPwd = await store.getSyncPassword('alice');
    const key = UserStore.hashSyncPassword(syncPwd!);
    expect(await store.authenticateSync('alice', key)).toBe(true);
  });

  it('returns false for wrong key', async () => {
    await store.createUser('alice', null);
    expect(await store.authenticateSync('alice', 'wrongkey')).toBe(false);
  });

  it('returns false when syncPassword is null', async () => {
    // createUser with explicit syncPassword: null (bypassing auto-generation)
    await prisma.user.create({
      data: {
        id: `test-id-${Math.random().toString(36).slice(2)}`,
        username: 'alice',
        passwordHash: null,
        syncPassword: null,
      },
    });
    expect(await store.authenticateSync('alice', 'anything')).toBe(false);
  });

  it('returns false for unknown user', async () => {
    expect(await store.authenticateSync('nobody', 'key')).toBe(false);
  });
});

describe('UserStore.getSyncPassword', () => {
  it('returns the stored syncPassword', async () => {
    await store.createUser('alice', null);
    const p1 = await store.getSyncPassword('alice');
    const p2 = await store.getSyncPassword('alice');
    expect(p1).toBe(p2); // same value on second call (persisted)
  });

  it('lazy-generates and saves when syncPassword is null', async () => {
    await prisma.user.create({
      data: {
        id: `test-id-${Math.random().toString(36).slice(2)}`,
        username: 'alice',
        passwordHash: null,
        syncPassword: null,
      },
    });
    const pwd = await store.getSyncPassword('alice');
    expect(pwd).not.toBeNull();
    expect(pwd!.split(' ')).toHaveLength(2);
    // Confirm it was persisted
    expect(await store.getSyncPassword('alice')).toBe(pwd);
  });

  it('returns null for unknown user', async () => {
    expect(await store.getSyncPassword('nobody')).toBeNull();
  });
});

describe('UserStore.changeSyncPassword', () => {
  it('updates syncPassword and returns true', async () => {
    await store.createUser('alice', null);
    expect(await store.changeSyncPassword('alice', 'swift stone')).toBe(true);
    expect(await store.getSyncPassword('alice')).toBe('swift stone');
  });

  it('returns false for unknown user', async () => {
    expect(await store.changeSyncPassword('nobody', 'phrase')).toBe(false);
  });
});

describe('UserStore.generateLoginPassword', () => {
  it('returns a 16-character password', () => {
    expect(UserStore.generateLoginPassword()).toHaveLength(16);
  });

  it('only uses unambiguous alphanumeric characters', () => {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    for (let i = 0; i < 50; i++) {
      const password = UserStore.generateLoginPassword();
      for (const ch of password) {
        expect(charset).toContain(ch);
      }
    }
  });
});

describe('UserStore.resetPassword', () => {
  it('sets a new passwordHash and mustChangePassword flag, returns the plaintext password', async () => {
    const oldHash = await UserStore.hashLoginPassword('old');
    await store.createUser('alice', oldHash);

    const newPassword = await store.resetPassword('alice');

    expect(newPassword).not.toBeNull();
    expect(newPassword).toHaveLength(16);
    expect(await store.validateUser('alice', newPassword!)).toBeTruthy();
    expect(await store.validateUser('alice', 'old')).toBe(false);
    expect(await store.getMustChangePassword('alice')).toBe(true);
  });

  it('returns null for unknown user', async () => {
    expect(await store.resetPassword('nobody')).toBeNull();
  });
});

describe('UserStore.getMustChangePassword', () => {
  it('returns false by default', async () => {
    await store.createUser('alice', null);
    expect(await store.getMustChangePassword('alice')).toBe(false);
  });

  it('returns true after resetPassword', async () => {
    await store.createUser('alice', null);
    await store.resetPassword('alice');
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

describe('UserStore.getUserProgress', () => {
  let aliceId: string;
  let bobId: string;

  beforeEach(async () => {
    await store.createUser('alice', null);
    aliceId = (await store.getUserIdByUsername('alice'))!;
  });

  it('returns empty array when user has no progress', async () => {
    expect(await store.getUserProgress(aliceId)).toEqual([]);
  });

  it('returns all progress records ordered by timestamp descending', async () => {
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd1',
      timestamp: 100,
    });
    await store.saveProgress(aliceId, {
      document: 'doc2',
      progress: '/p[2]',
      percentage: 0.8,
      device: 'Kobo',
      device_id: 'd1',
      timestamp: 200,
    });
    const records = await store.getUserProgress(aliceId);
    expect(records).toHaveLength(2);
    expect(records[0].document).toBe('doc2');
    expect(records[1].document).toBe('doc1');
  });

  it('only returns records for the specified user', async () => {
    await store.createUser('bob', null);
    bobId = (await store.getUserIdByUsername('bob'))!;
    await store.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    await store.saveProgress(bobId, {
      document: 'doc2',
      progress: '/p[1]',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'd2',
    });
    const aliceRecords = await store.getUserProgress(aliceId);
    expect(aliceRecords).toHaveLength(1);
    expect(aliceRecords[0].document).toBe('doc1');
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
    expect(await store.getUserProgress(aliceId)).toEqual([]);
  });

  it('does not affect other users', async () => {
    await store.createUser('bob', null);
    await store.deleteUser('alice');
    expect(await store.userExists('bob')).toBe(true);
  });
});

describe('UserStore.authenticate', () => {
  it('returns the user ID string with correct sync password key', async () => {
    await store.createUser('alice', null);
    const syncPwd = await store.getSyncPassword('alice');
    const key = UserStore.hashSyncPassword(syncPwd!);
    const result = await store.authenticate('alice', key);
    expect(result).toMatch(/^[A-Za-z0-9]{21}$/);
  });

  it('returns false for wrong sync key', async () => {
    await store.createUser('alice', null);
    expect(await store.authenticate('alice', 'wrongkey')).toBe(false);
  });

  it('returns false when syncPassword is null', async () => {
    await prisma.user.create({ data: { id: 'nosync-id', username: 'nosync', syncPassword: null } });
    expect(await store.authenticate('nosync', 'anything')).toBe(false);
  });

  it('returns false for unknown user', async () => {
    expect(await store.authenticate('nobody', 'key')).toBe(false);
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

describe('UserStore.generateSyncPassword', () => {
  it('returns two words separated by a space', () => {
    const result = UserStore.generateSyncPassword();
    expect(result.split(' ')).toHaveLength(2);
  });

  it('never exceeds 15 characters across 100 calls', () => {
    for (let i = 0; i < 100; i++) {
      expect(UserStore.generateSyncPassword().length).toBeLessThanOrEqual(15);
    }
  });

  it('uses words from the wordlist', () => {
    const [w1, w2] = UserStore.generateSyncPassword().split(' ');
    expect(WORDLIST).toContain(w1);
    expect(WORDLIST).toContain(w2);
  });
});

describe('UserStore.hashSyncPassword', () => {
  it('returns the MD5 hex digest of the input', () => {
    const expected = crypto.createHash('md5').update('blue oak').digest('hex');
    expect(UserStore.hashSyncPassword('blue oak')).toBe(expected);
  });
});

describe('UserStore.hashLoginPassword / verifyLoginPassword', () => {
  it('produces a hash that verifies correctly', async () => {
    const hash = await UserStore.hashLoginPassword('s3cr3t');
    expect(await UserStore.verifyLoginPassword('s3cr3t', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await UserStore.hashLoginPassword('s3cr3t');
    expect(await UserStore.verifyLoginPassword('wrong', hash)).toBe(false);
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
    jest
      .spyOn(prisma.progressHistory, 'findFirst')
      .mockRejectedValueOnce(new Error('simulated DB failure'));

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

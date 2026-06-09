import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { UserStore } from './user-store';
import { runMigrations } from '../db/migrate';

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
  it('returns true on first registration', async () => {
    expect(await store.createUser('alice', 'secret')).toBe(true);
  });

  it('returns false on duplicate username', async () => {
    await store.createUser('alice', 'secret');
    expect(await store.createUser('alice', 'other')).toBe(false);
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

describe('UserStore.authenticate', () => {
  beforeEach(async () => {
    await store.createUser('alice', UserStore.hashPassword('secret'));
  });

  it('returns the user ID string with correct MD5 key', async () => {
    const key = UserStore.hashPassword('secret');
    const result = await store.authenticate('alice', key);
    expect(result).toMatch(/^[A-Za-z0-9]{21}$/);
  });

  it('returns false with wrong key', async () => {
    expect(await store.authenticate('alice', 'wronghash')).toBe(false);
  });

  it('returns false for unknown user', async () => {
    const key = UserStore.hashPassword('secret');
    expect(await store.authenticate('nobody', key)).toBe(false);
  });
});

describe('UserStore.saveProgress + getProgress', () => {
  let aliceId: string;

  beforeEach(async () => {
    await store.createUser('alice', 'secret');
    aliceId = (await store.authenticate('alice', 'secret')) as string;
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
    await store.createUser('alice', 'secret');
    expect(await store.userExists('alice')).toBe(true);
  });
});

describe('UserStore.listUsers', () => {
  it('returns empty array when no users', async () => {
    expect(await store.listUsers()).toEqual([]);
  });

  it('returns users sorted by username with progress count', async () => {
    await store.createUser('zara', 'pass');
    await store.createUser('alice', 'pass');
    const aliceId = (await store.authenticate('alice', 'pass')) as string;
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
    await store.createUser('alice', 'pass');
    aliceId = (await store.authenticate('alice', 'pass')) as string;
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
    await store.createUser('bob', 'pass');
    bobId = (await store.authenticate('bob', 'pass')) as string;
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
    await store.createUser('alice', 'pass');
    aliceId = (await store.authenticate('alice', 'pass')) as string;
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
    await store.createUser('bob', 'pass');
    await store.deleteUser('alice');
    expect(await store.userExists('bob')).toBe(true);
  });
});

describe('UserStore.validateUser', () => {
  beforeEach(async () => {
    await store.createUser('alice', UserStore.hashPassword('secret'));
  });

  it('returns the user ID string with correct plaintext password', async () => {
    const result = await store.validateUser('alice', 'secret');
    expect(result).toMatch(/^[A-Za-z0-9]{21}$/);
  });

  it('returns false with wrong password', async () => {
    expect(await store.validateUser('alice', 'wrongpass')).toBe(false);
  });

  it('returns false for unknown user', async () => {
    expect(await store.validateUser('nobody', 'secret')).toBe(false);
  });
});

describe('UserStore.getUserIdByUsername', () => {
  it('returns null for unknown user', async () => {
    expect(await store.getUserIdByUsername('nobody')).toBeNull();
  });

  it('returns the user ID for a known user', async () => {
    await store.createUser('alice', 'pass');
    const id = await store.getUserIdByUsername('alice');
    expect(id).toMatch(/^[A-Za-z0-9]{21}$/);
  });

  it('returns consistent ID matching authenticate', async () => {
    await store.createUser('alice', 'pass');
    const idFromLookup = await store.getUserIdByUsername('alice');
    const idFromAuth = await store.authenticate('alice', 'pass') as string;
    expect(idFromLookup).toBe(idFromAuth);
  });
});

describe('UserStore.clearProgress', () => {
  let aliceId: string;
  let bobId: string;

  beforeEach(async () => {
    await store.createUser('alice', 'pass');
    await store.createUser('bob', 'pass');
    aliceId = (await store.authenticate('alice', 'pass')) as string;
    bobId = (await store.authenticate('bob', 'pass')) as string;
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

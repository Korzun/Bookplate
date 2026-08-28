import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import {
  authenticate,
  changePassword,
  changeSyncPassword,
  generateLoginPassword,
  generateSyncPassword,
  getMustChangePassword,
  getSyncPassword,
  hashLoginPassword,
  hashSyncPassword,
  resetPassword,
  userHasPassword,
  validateUser,
  verifyLoginPassword,
} from './password';
import { createUser } from './user';
import { WORDLIST } from './wordlist';

vi.mock('../logger');

let prisma: PrismaClient;
let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, os.tmpdir());
});

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

describe('validateUser', () => {
  it('returns the user ID string for correct password', async () => {
    const hash = await hashLoginPassword('mypass');
    await createUser(prisma, 'alice', hash);
    const result = await validateUser(prisma, 'alice', 'mypass');
    expect(result).toMatch(/^[A-Za-z0-9]{21}$/);
  });

  it('returns false for wrong password', async () => {
    const hash = await hashLoginPassword('mypass');
    await createUser(prisma, 'alice', hash);
    expect(await validateUser(prisma, 'alice', 'wrong')).toBe(false);
  });

  it('returns false when passwordHash is null', async () => {
    await createUser(prisma, 'alice', null);
    expect(await validateUser(prisma, 'alice', 'anything')).toBe(false);
  });
});

describe('userHasPassword', () => {
  it('returns true when passwordHash is set', async () => {
    const hash = await hashLoginPassword('pw');
    await createUser(prisma, 'alice', hash);
    expect(await userHasPassword(prisma, 'alice')).toBe(true);
  });

  it('returns false when passwordHash is null', async () => {
    await createUser(prisma, 'alice', null);
    expect(await userHasPassword(prisma, 'alice')).toBe(false);
  });

  it('returns false for unknown user', async () => {
    expect(await userHasPassword(prisma, 'nobody')).toBe(false);
  });
});

describe('getMustChangePassword', () => {
  it('returns false by default', async () => {
    await createUser(prisma, 'alice', null);
    expect(await getMustChangePassword(prisma, 'alice')).toBe(false);
  });

  it('returns true after resetPassword', async () => {
    await createUser(prisma, 'alice', null);
    await resetPassword(prisma, 'alice');
    expect(await getMustChangePassword(prisma, 'alice')).toBe(true);
  });

  it('returns false for unknown user', async () => {
    expect(await getMustChangePassword(prisma, 'nobody')).toBe(false);
  });
});

describe('changePassword', () => {
  it('updates passwordHash and allows login with new password', async () => {
    const oldHash = await hashLoginPassword('old');
    await createUser(prisma, 'alice', oldHash);
    const newHash = await hashLoginPassword('new');
    expect(await changePassword(prisma, 'alice', newHash)).toBe(true);
    expect(await validateUser(prisma, 'alice', 'new')).toBeTruthy();
    expect(await validateUser(prisma, 'alice', 'old')).toBe(false);
  });

  it('returns false for unknown user', async () => {
    expect(await changePassword(prisma, 'nobody', 'hash')).toBe(false);
  });

  it('clears mustChangePassword flag', async () => {
    await createUser(prisma, 'alice', null);
    await resetPassword(prisma, 'alice');
    expect(await getMustChangePassword(prisma, 'alice')).toBe(true);

    const newHash = await hashLoginPassword('newpass');
    await changePassword(prisma, 'alice', newHash);

    expect(await getMustChangePassword(prisma, 'alice')).toBe(false);
  });
});

describe('getSyncPassword', () => {
  it('returns the stored syncPassword', async () => {
    await createUser(prisma, 'alice', null);
    const p1 = await getSyncPassword(prisma, 'alice');
    const p2 = await getSyncPassword(prisma, 'alice');
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
    const pwd = await getSyncPassword(prisma, 'alice');
    expect(pwd).not.toBeNull();
    expect(pwd!.split(' ')).toHaveLength(2);
    // Confirm it was persisted
    expect(await getSyncPassword(prisma, 'alice')).toBe(pwd);
  });

  it('returns null for unknown user', async () => {
    expect(await getSyncPassword(prisma, 'nobody')).toBeNull();
  });
});

describe('changeSyncPassword', () => {
  it('updates syncPassword and returns true', async () => {
    await createUser(prisma, 'alice', null);
    expect(await changeSyncPassword(prisma, 'alice', 'swift stone')).toBe(true);
    expect(await getSyncPassword(prisma, 'alice')).toBe('swift stone');
  });

  it('returns false for unknown user', async () => {
    expect(await changeSyncPassword(prisma, 'nobody', 'phrase')).toBe(false);
  });
});

describe('generateLoginPassword', () => {
  it('returns a 16-character password', () => {
    expect(generateLoginPassword()).toHaveLength(16);
  });

  it('only uses unambiguous alphanumeric characters', () => {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    for (let i = 0; i < 50; i++) {
      const password = generateLoginPassword();
      for (const ch of password) {
        expect(charset).toContain(ch);
      }
    }
  });
});

describe('resetPassword', () => {
  it('sets a new passwordHash and mustChangePassword flag, returns the plaintext password', async () => {
    const oldHash = await hashLoginPassword('old');
    await createUser(prisma, 'alice', oldHash);

    const newPassword = await resetPassword(prisma, 'alice');

    expect(newPassword).not.toBeNull();
    expect(newPassword).toHaveLength(16);
    expect(await validateUser(prisma, 'alice', newPassword!)).toBeTruthy();
    expect(await validateUser(prisma, 'alice', 'old')).toBe(false);
    expect(await getMustChangePassword(prisma, 'alice')).toBe(true);
  });

  it('returns null for unknown user', async () => {
    expect(await resetPassword(prisma, 'nobody')).toBeNull();
  });
});

describe('authenticate', () => {
  it('returns the user ID string with correct sync password key', async () => {
    await createUser(prisma, 'alice', null);
    const syncPwd = await getSyncPassword(prisma, 'alice');
    const key = hashSyncPassword(syncPwd!);
    const result = await authenticate(prisma, 'alice', key);
    expect(result).toMatch(/^[A-Za-z0-9]{21}$/);
  });

  it('returns false for wrong sync key', async () => {
    await createUser(prisma, 'alice', null);
    expect(await authenticate(prisma, 'alice', 'wrongkey')).toBe(false);
  });

  it('returns false when syncPassword is null', async () => {
    await prisma.user.create({ data: { id: 'nosync-id', username: 'nosync', syncPassword: null } });
    expect(await authenticate(prisma, 'nosync', 'anything')).toBe(false);
  });

  it('returns false for unknown user', async () => {
    expect(await authenticate(prisma, 'nobody', 'key')).toBe(false);
  });
});

describe('generateSyncPassword', () => {
  it('returns two words separated by a space', () => {
    const result = generateSyncPassword();
    expect(result.split(' ')).toHaveLength(2);
  });

  it('never exceeds 15 characters across 100 calls', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateSyncPassword().length).toBeLessThanOrEqual(15);
    }
  });

  it('uses words from the wordlist', () => {
    const [w1, w2] = generateSyncPassword().split(' ');
    expect(WORDLIST).toContain(w1);
    expect(WORDLIST).toContain(w2);
  });
});

describe('hashSyncPassword', () => {
  it('returns the MD5 hex digest of the input', () => {
    const expected = crypto.createHash('md5').update('blue oak').digest('hex');
    expect(hashSyncPassword('blue oak')).toBe(expected);
  });
});

describe('hashLoginPassword / verifyLoginPassword', () => {
  it('produces a hash that verifies correctly', async () => {
    const hash = await hashLoginPassword('s3cr3t');
    expect(await verifyLoginPassword('s3cr3t', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashLoginPassword('s3cr3t');
    expect(await verifyLoginPassword('wrong', hash)).toBe(false);
  });
});

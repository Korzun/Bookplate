import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { runMigrations } from '../db/migrate';
import { TokenStore, REFRESH_TOKEN_TTL_MS } from './token-store';
import { UserStore } from './user-store';

jest.mock('../logger');

let prisma: PrismaClient;
let store: TokenStore;
let dbPath: string;
let booksDir: string;
let users: UserStore;

// Pre-created user IDs for tests that need FK-valid userId values
let aliceId: string;
let bobId: string;

beforeEach(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-ts-'));
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
  store = new TokenStore(prisma);
  users = new UserStore(prisma);

  // Create real users so FK-referencing inserts succeed (foreign_keys = ON)
  await users.createUser('alice', await UserStore.hashLoginPassword('pw'));
  await users.createUser('bob', await UserStore.hashLoginPassword('pw'));
  aliceId = (await prisma.user.findUnique({ where: { username: 'alice' } }))!.id;
  bobId = (await prisma.user.findUnique({ where: { username: 'bob' } }))!.id;
});

afterEach(async () => {
  await prisma.$disconnect();
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(booksDir, { recursive: true, force: true });
});

describe('getOrCreateJwtSecret', () => {
  it('generates a 32-byte secret on first call', async () => {
    const secret = await store.getOrCreateJwtSecret();
    expect(secret).toBeInstanceOf(Buffer);
    expect(secret.length).toBe(32);
  });

  it('returns the same secret on subsequent calls', async () => {
    const first = await store.getOrCreateJwtSecret();
    const second = await store.getOrCreateJwtSecret();
    expect(second.equals(first)).toBe(true);
  });

  it('persists the secret across store instances', async () => {
    const first = await store.getOrCreateJwtSecret();
    const second = await new TokenStore(prisma).getOrCreateJwtSecret();
    expect(second.equals(first)).toBe(true);
  });
});

describe('refresh tokens', () => {
  it('creates a token that can be consumed once', async () => {
    const token = await store.createRefreshToken({ username: 'alice', userId: aliceId });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url

    const identity = await store.consumeRefreshToken(token);
    expect(identity).toEqual({ username: 'alice', userId: aliceId });

    // rotation: a second consume of the same token fails
    expect(await store.consumeRefreshToken(token)).toBeNull();
  });

  it('supports a null userId (config admin)', async () => {
    const token = await store.createRefreshToken({ username: 'admin', userId: null });
    expect(await store.consumeRefreshToken(token)).toEqual({ username: 'admin', userId: null });
  });

  it('rejects unknown tokens', async () => {
    expect(await store.consumeRefreshToken('not-a-real-token')).toBeNull();
  });

  it('rejects and deletes expired tokens', async () => {
    const token = await store.createRefreshToken({ username: 'alice', userId: aliceId });
    await prisma.refreshToken.updateMany({ data: { expiresAt: Date.now() - 1000 } });
    expect(await store.consumeRefreshToken(token)).toBeNull();
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('stores only a hash, never the raw token', async () => {
    const token = await store.createRefreshToken({ username: 'alice', userId: aliceId });
    const rows = await prisma.refreshToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sets expiry ~30 days out', async () => {
    await store.createRefreshToken({ username: 'alice', userId: aliceId });
    const row = (await prisma.refreshToken.findMany())[0];
    expect(row.expiresAt).toBeGreaterThan(Date.now() + REFRESH_TOKEN_TTL_MS - 60_000);
    expect(row.expiresAt).toBeLessThanOrEqual(Date.now() + REFRESH_TOKEN_TTL_MS);
  });

  it('revokeRefreshToken deletes the row', async () => {
    const token = await store.createRefreshToken({ username: 'alice', userId: aliceId });
    await store.revokeRefreshToken(token);
    expect(await store.consumeRefreshToken(token)).toBeNull();
  });

  it("revokeAllForUsername deletes only that user's tokens", async () => {
    const a = await store.createRefreshToken({ username: 'alice', userId: aliceId });
    const b = await store.createRefreshToken({ username: 'bob', userId: bobId });
    await store.revokeAllForUsername('alice');
    expect(await store.consumeRefreshToken(a)).toBeNull();
    expect(await store.consumeRefreshToken(b)).toEqual({ username: 'bob', userId: bobId });
  });

  it('deleteExpired sweeps only expired rows', async () => {
    const live = await store.createRefreshToken({ username: 'alice', userId: aliceId });
    await store.createRefreshToken({ username: 'bob', userId: bobId });
    await prisma.refreshToken.updateMany({
      where: { username: 'bob' },
      data: { expiresAt: Date.now() - 1000 },
    });
    await store.deleteExpired();
    expect(await prisma.refreshToken.count()).toBe(1);
    expect(await store.consumeRefreshToken(live)).toEqual({ username: 'alice', userId: aliceId });
  });

  it('rows are cascade-deleted with the user', async () => {
    await users.createUser('carol', await UserStore.hashLoginPassword('pw'));
    const carolId = (await prisma.user.findUnique({ where: { username: 'carol' } }))!.id;
    await store.createRefreshToken({ username: 'carol', userId: carolId });
    await users.deleteUser('carol');
    expect(await prisma.refreshToken.count()).toBe(0);
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { runMigrations } from '../db/migrate';
import { BookStore, ScanImporter } from '../services/book-store';
import { UserStore } from '../services/user-store';
import { TokenStore } from '../services/token-store';
import { createUsersRouter } from './users';
import { jwtAuth } from '../middleware/auth';
import { signAccessToken } from '../services/jwt';
import { EpubMeta } from '../types';

const jwtSecret = crypto.randomBytes(32);

const FAKE_META: EpubMeta = {
  title: 'Test Book',
  author: 'Author Name',
  description: '',
  publisher: '',
  series: '',
  seriesIndex: 0,
  fileAs: '',
  identifiers: [],
  subjects: [],
  coverData: null,
  coverMime: null,
  chapterCount: 0,
  chapterSpineMap: [],
  chapterNames: [],
  pageCount: 0,
};

jest.mock('../logger');

let prisma: PrismaClient;
let userStore: UserStore;
let tokenStore: TokenStore;
let app: express.Express;
let dbPath: string;
let booksRoot: string;

beforeEach(async () => {
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  booksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'users-test-'));
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksRoot);
  userStore = new UserStore(prisma);
  tokenStore = new TokenStore(prisma);

  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    '/api/users',
    createUsersRouter(userStore, 'admin', jwtAuth(jwtSecret), tokenStore, booksRoot)
  );
});

afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
  fs.rmSync(booksRoot, { recursive: true, force: true });
});

const adminToken = () =>
  signAccessToken(jwtSecret, { username: 'admin', isAdmin: true, mustChangePassword: false });
const userToken = () =>
  signAccessToken(jwtSecret, {
    userId: 'u1',
    username: 'alice',
    isAdmin: false,
    mustChangePassword: false,
  });

describe('GET /api/users', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns empty array when no users', async () => {
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns users with progress counts', async () => {
    await userStore.createUser('alice', 'pass');
    const aliceId = (await userStore.getUserIdByUsername('alice'))!;
    await userStore.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].username).toBe('alice');
    expect(res.body[0].progressCount).toBe(1);
  });
});

describe('GET /api/users/:username/progress', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/users/alice/progress');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 for unknown user', async () => {
    const res = await request(app)
      .get('/api/users/nobody/progress')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
  });

  it('returns empty array for user with no progress', async () => {
    await userStore.createUser('alice', 'pass');
    const res = await request(app)
      .get('/api/users/alice/progress')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns progress records for a user', async () => {
    await userStore.createUser('alice', 'pass');
    const aliceId = (await userStore.getUserIdByUsername('alice'))!;
    await userStore.saveProgress(aliceId, {
      document: 'dune.epub',
      progress: '/p[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'd1',
    });
    const res = await request(app)
      .get('/api/users/alice/progress')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].document).toBe('dune.epub');
    expect(res.body[0].percentage).toBeCloseTo(0.42);
  });

  it('returns only the current-id entry after a reimport changes the book id', async () => {
    const booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'users-lineage-'));
    const bookStore = new BookStore(booksDir, prisma);
    try {
      await userStore.createUser('alice', 'pass');
      const aliceId = (await userStore.getUserIdByUsername('alice'))!;
      const aliceOwner = { userId: aliceId, username: 'alice' };
      const stagedPath = path.join(booksDir, 'staged-lin.epub');
      fs.writeFileSync(stagedPath, 'x');
      await bookStore.addBook(aliceOwner, 'lin-old', stagedPath, FAKE_META);
      await userStore.saveProgress(aliceId, {
        document: 'lin-old',
        progress: '/p[2]',
        percentage: 0.4,
        device: 'Kobo',
        device_id: 'd1',
      });
      const mockImporter: ScanImporter = {
        parseEpub: () => FAKE_META,
        partialMD5: () => 'lin-new',
      };
      await bookStore.reimportBook(aliceOwner, 'lin-old', mockImporter);
      const res = await request(app)
        .get('/api/users/alice/progress')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].document).toBe('lin-new');
    } finally {
      fs.rmSync(booksDir, { recursive: true, force: true });
    }
  });
});

describe('DELETE /api/users/:username', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).delete('/api/users/alice');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 for unknown user', async () => {
    const res = await request(app)
      .delete('/api/users/nobody')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
  });

  it('deletes the user and returns 204', async () => {
    await userStore.createUser('alice', 'pass');
    const res = await request(app)
      .delete('/api/users/alice')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(204);
    expect(await userStore.userExists('alice')).toBe(false);
  });

  it("removes the user's library folder on disk", async () => {
    await userStore.createUser('alice', 'pass');
    const userDir = path.join(booksRoot, 'alice');
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, 'book.epub'), 'x');
    await request(app).delete('/api/users/alice').set('Authorization', `Bearer ${adminToken()}`);
    expect(fs.existsSync(userDir)).toBe(false);
  });

  it('cascades to delete progress records', async () => {
    await userStore.createUser('alice', 'pass');
    const aliceId = (await userStore.getUserIdByUsername('alice'))!;
    await userStore.saveProgress(aliceId, {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    await request(app).delete('/api/users/alice').set('Authorization', `Bearer ${adminToken()}`);
    expect(await userStore.getUserProgress(aliceId)).toEqual([]);
  });
});

describe('POST /api/users', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/users').send({ username: 'bob', password: 'pass' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it("creates the user's library folder on disk", async () => {
    await request(app)
      .post('/api/users')
      .send({ username: 'bob', password: 'secret' })
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(fs.existsSync(path.join(booksRoot, 'bob'))).toBe(true);
  });

  it('creates a user and returns 201', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'bob', password: 'secret' })
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(201);
    expect(res.body.username).toBe('bob');
    expect(await userStore.userExists('bob')).toBe(true);
    expect(await userStore.validateUser('bob', 'secret')).toBeTruthy();
  });

  it('returns 409 for duplicate username', async () => {
    await userStore.createUser('bob', null);
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'bob', password: 'other' })
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Username already exists');
  });

  it('returns 400 when username is missing', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ password: 'pass' })
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and password are required');
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'bob' })
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and password are required');
  });

  it('returns 400 when username is blank', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: '   ', password: 'pass' })
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and password are required');
  });

  it('returns 400 when password is blank', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'bob', password: '   ' })
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and password are required');
  });

  it('returns 409 when username matches admin', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'admin', password: 'anything' })
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(409);
  });

  it('rejects usernames with invalid characters', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'bad/name', password: 'secret123' })
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/letters, numbers/i);
  });

  it('rejects usernames starting with a dot', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: '.staging', password: 'secret123' })
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(400);
  });

  it('accepts a valid username with dot and dash', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'jane.doe-2', password: 'secret123' })
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(201);
  });
});

describe('POST /api/users/:username/reset-password', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/users/alice/reset-password');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 for unknown user', async () => {
    const res = await request(app)
      .post('/api/users/nobody/reset-password')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('resets the password and returns it', async () => {
    const oldHash = await UserStore.hashLoginPassword('oldpass');
    await userStore.createUser('alice', oldHash);

    const res = await request(app)
      .post('/api/users/alice/reset-password')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.password).toBe('string');
    expect(res.body.password).toHaveLength(16);
    expect(await userStore.validateUser('alice', res.body.password)).toBeTruthy();
    expect(await userStore.validateUser('alice', 'oldpass')).toBe(false);
    expect(await userStore.getMustChangePassword('alice')).toBe(true);
  });

  it('returns 403 for the built-in admin username', async () => {
    const res = await request(app)
      .post(`/api/users/admin/reset-password`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(403);
  });

  it("revokes the user's refresh tokens", async () => {
    await userStore.createUser('alice', 'pass');
    const aliceId = (await userStore.getUserIdByUsername('alice'))!;
    await tokenStore.createRefreshToken({ username: 'alice', userId: aliceId });
    expect(await prisma.refreshToken.count({ where: { username: 'alice' } })).toBe(1);
    await request(app)
      .post('/api/users/alice/reset-password')
      .set('Authorization', `Bearer ${adminToken()}`)
      .expect(200);
    expect(await prisma.refreshToken.count({ where: { username: 'alice' } })).toBe(0);
  });
});

describe('DELETE /api/users/:username/progress/:document', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).delete('/api/users/alice/progress/doc1');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 when user does not exist', async () => {
    const res = await request(app)
      .delete('/api/users/nobody/progress/doc1')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('returns 404 when user exists but has no progress for that document', async () => {
    await userStore.createUser('alice', 'pass');
    const res = await request(app)
      .delete('/api/users/alice/progress/nonexistent')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Progress record not found');
  });

  it('clears the progress record and returns 204', async () => {
    await userStore.createUser('alice', 'pass');
    const aliceId = (await userStore.getUserIdByUsername('alice'))!;
    await userStore.saveProgress(aliceId, {
      document: 'dune.epub',
      progress: '/p[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'd1',
    });
    const res = await request(app)
      .delete('/api/users/alice/progress/dune.epub')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(204);
    expect(await userStore.getProgress(aliceId, 'dune.epub')).toBeNull();
  });
});

describe('RBAC — regular user is forbidden from all /api/users routes', () => {
  it('GET /api/users returns 403 for regular user', async () => {
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${userToken()}`);
    expect(res.status).toBe(403);
  });

  it('POST /api/users returns 403 for regular user', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'bob', password: 'pass' })
      .set('Authorization', `Bearer ${userToken()}`);
    expect(res.status).toBe(403);
  });

  it('DELETE /api/users/:username returns 403 for regular user', async () => {
    await userStore.createUser('victim', 'pass');
    const res = await request(app)
      .delete('/api/users/victim')
      .set('Authorization', `Bearer ${userToken()}`);
    expect(res.status).toBe(403);
  });

  it('GET /api/users/:username/progress returns 403 for regular user', async () => {
    await userStore.createUser('alice', 'pass');
    const res = await request(app)
      .get('/api/users/alice/progress')
      .set('Authorization', `Bearer ${userToken()}`);
    expect(res.status).toBe(403);
  });

  it('DELETE /api/users/:username/progress/:document returns 403 for regular user', async () => {
    await userStore.createUser('alice', 'pass');
    const res = await request(app)
      .delete('/api/users/alice/progress/doc1')
      .set('Authorization', `Bearer ${userToken()}`);
    expect(res.status).toBe(403);
  });

  it('POST /api/users/:username/reset-password returns 403 for regular user', async () => {
    await userStore.createUser('victim', 'pass');
    const res = await request(app)
      .post('/api/users/victim/reset-password')
      .set('Authorization', `Bearer ${userToken()}`);
    expect(res.status).toBe(403);
  });
});

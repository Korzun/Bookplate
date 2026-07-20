import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { runMigrations } from '../db/migrate';
import request from 'supertest';
import express from 'express';
import { UserStore } from '../services/user-store';
import { BookStore } from '../services/book-store';
import { createKosyncRouter } from './kosync';

vi.mock('../logger');

let prisma: PrismaClient;
let userStore: UserStore;
let bookStore: BookStore;
let app: express.Express;
let dbPath: string;
let booksDir: string;

beforeEach(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosync-test-'));
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
  userStore = new UserStore(prisma);
  bookStore = new BookStore(booksDir, prisma);
  app = express();
  app.use(express.json());
  app.use('/sync', createKosyncRouter(userStore, bookStore));
});

afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
  fs.rmSync(booksDir, { recursive: true, force: true });
});

const ALICE_SYNC_PASSWORD = 'secret';

function authHeaders(username: string, syncPassword: string) {
  return {
    'x-auth-user': username,
    'x-auth-key': UserStore.hashSyncPassword(syncPassword),
  };
}

describe('POST /sync/users/create', () => {
  it('returns 404 — self-registration is disabled', async () => {
    const res = await request(app)
      .post('/sync/users/create')
      .send({ username: 'newuser', password: 'abc123' });
    expect(res.status).toBe(404);
  });
});

describe('GET /sync/users/auth', () => {
  beforeEach(async () => {
    await userStore.createUser('alice', null, ALICE_SYNC_PASSWORD);
  });

  it('returns 200 with correct credentials', async () => {
    const res = await request(app).get('/sync/users/auth').set(authHeaders('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authorized: 'OK' });
  });

  it('returns 401 with wrong password', async () => {
    const res = await request(app)
      .get('/sync/users/auth')
      .set({ 'x-auth-user': 'alice', 'x-auth-key': 'badsecret' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with missing headers', async () => {
    const res = await request(app).get('/sync/users/auth');
    expect(res.status).toBe(401);
  });
});

describe('PUT /sync/syncs/progress', () => {
  beforeEach(async () => {
    await userStore.createUser('alice', null, ALICE_SYNC_PASSWORD);
  });

  it('saves progress and returns document + timestamp', async () => {
    const res = await request(app)
      .put('/sync/syncs/progress')
      .set(authHeaders('alice', 'secret'))
      .send({
        document: 'docHash123',
        progress: '/body/DocFragment[5]',
        percentage: 0.42,
        device: 'Kobo',
        device_id: 'dev-1',
      });
    expect(res.status).toBe(200);
    expect(res.body.document).toBe('docHash123');
    expect(typeof res.body.timestamp).toBe('number');
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .put('/sync/syncs/progress')
      .set(authHeaders('alice', 'secret'))
      .send({ document: 'docHash123' });
    expect(res.status).toBe(400);
  });
});

describe('GET /sync/syncs/progress/:document', () => {
  beforeEach(async () => {
    await userStore.createUser('alice', null, ALICE_SYNC_PASSWORD);
    await request(app)
      .put('/sync/syncs/progress')
      .set(authHeaders('alice', ALICE_SYNC_PASSWORD))
      .send({
        document: 'docHash123',
        progress: '/body/DocFragment[5]',
        percentage: 0.42,
        device: 'Kobo',
        device_id: 'dev-1',
      });
  });

  it('returns saved progress', async () => {
    const res = await request(app)
      .get('/sync/syncs/progress/docHash123')
      .set(authHeaders('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.body.progress).toBe('/body/DocFragment[5]');
    expect(res.body.percentage).toBeCloseTo(0.42);
  });

  it('returns 404 for unknown document', async () => {
    const res = await request(app)
      .get('/sync/syncs/progress/unknown')
      .set(authHeaders('alice', 'secret'));
    expect(res.status).toBe(404);
  });
});

describe('KOSync lineage resolution', () => {
  beforeEach(async () => {
    await userStore.createUser('alice', null, ALICE_SYNC_PASSWORD);
    // Seed a per-user history entry for alice: 'old-doc-id' → 'current-doc-id'
    const alice = await prisma.user.findUnique({ where: { username: 'alice' } });
    await prisma.$executeRaw`
      INSERT INTO book_id_history (user_id, old_id, current_id)
      VALUES (${alice!.id}, 'old-doc-id', 'current-doc-id')
    `;
  });

  it('PUT with old ID stores progress under current ID', async () => {
    await request(app).put('/sync/syncs/progress').set(authHeaders('alice', 'secret')).send({
      document: 'old-doc-id',
      progress: '/body/DocFragment[3]',
      percentage: 0.3,
      device: 'Kobo',
      device_id: 'dev-1',
    });

    // Fetch with the *current* ID — should find the saved progress
    const res = await request(app)
      .get('/sync/syncs/progress/current-doc-id')
      .set(authHeaders('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.body.percentage).toBeCloseTo(0.3);
  });

  it('PUT with old ID returns original document in response', async () => {
    const res = await request(app)
      .put('/sync/syncs/progress')
      .set(authHeaders('alice', 'secret'))
      .send({
        document: 'old-doc-id',
        progress: '/body/DocFragment[3]',
        percentage: 0.3,
        device: 'Kobo',
        device_id: 'dev-1',
      });
    expect(res.status).toBe(200);
    expect(res.body.document).toBe('old-doc-id');
  });

  it('GET with old ID returns progress stored under current ID', async () => {
    // Save progress under the current ID directly via Prisma
    const alice = await prisma.user.findUnique({ where: { username: 'alice' } });
    await prisma.$executeRaw`
      INSERT INTO progress (user_id, document, progress, percentage, device, device_id, timestamp)
      VALUES (${alice!.id}, 'current-doc-id', '/body/DocFragment[7]', 0.7, 'Kobo', 'dev-1', 1700000000)
    `;

    const res = await request(app)
      .get('/sync/syncs/progress/old-doc-id')
      .set(authHeaders('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.body.percentage).toBeCloseTo(0.7);
  });

  it('PUT and GET with current ID are unaffected', async () => {
    await request(app).put('/sync/syncs/progress').set(authHeaders('alice', 'secret')).send({
      document: 'current-doc-id',
      progress: '/body/DocFragment[5]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'dev-1',
    });

    const res = await request(app)
      .get('/sync/syncs/progress/current-doc-id')
      .set(authHeaders('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.body.percentage).toBeCloseTo(0.5);
  });
});

describe('PUT /sync/syncs/progress — history', () => {
  beforeEach(async () => {
    await userStore.createUser('alice', null, ALICE_SYNC_PASSWORD);
  });

  it('creates a history row on first sync', async () => {
    await request(app)
      .put('/sync/syncs/progress')
      .set(authHeaders('alice', ALICE_SYNC_PASSWORD))
      .send({
        document: 'docHash123',
        progress: '/body/DocFragment[5]',
        percentage: 0.42,
        device: 'Kobo',
        device_id: 'dev-1',
      });

    const alice = await prisma.user.findUnique({ where: { username: 'alice' } });
    const rows = await prisma.progressHistory.findMany({ where: { userId: alice!.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].progress).toBe('/body/DocFragment[5]');
    expect(rows[0].startTimestamp).toBe(rows[0].endTimestamp);
  });

  it('collapses two immediate syncs of the same position into one dwell row with extended endTimestamp', async () => {
    const body = {
      document: 'docHash123',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
    };
    const r1 = await request(app)
      .put('/sync/syncs/progress')
      .set(authHeaders('alice', ALICE_SYNC_PASSWORD))
      .send(body);
    const r2 = await request(app)
      .put('/sync/syncs/progress')
      .set(authHeaders('alice', ALICE_SYNC_PASSWORD))
      .send(body);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const alice = await prisma.user.findUnique({ where: { username: 'alice' } });
    const rows = await prisma.progressHistory.findMany({ where: { userId: alice!.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].startTimestamp).toBe(r1.body.timestamp);
    expect(rows[0].endTimestamp).toBe(r2.body.timestamp);
  });
});

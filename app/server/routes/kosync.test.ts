import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import type { Mock } from 'vitest';

import { runMigrations } from '../db/migrate';
import { logger } from '../logger';
import { hashSyncPassword } from '../services/password';
import { createUser } from '../services/user';
import { createKosyncRouter } from './kosync';

vi.mock('../logger');

// Captured at module load, before mockReset clears logger's call history.
function warnOf(namespace: string): Mock {
  const mocked = vi.mocked(logger);
  const index = mocked.mock.calls.findIndex(([name]) => name === namespace);
  if (index === -1) throw new Error(`logger('${namespace}') was never called`);
  return (mocked.mock.results[index].value as { warn: Mock }).warn;
}
const authWarn = warnOf('Auth');
const limiterWarn = warnOf('LoginLimiter');

let prisma: PrismaClient;
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
  app = express();
  app.use(express.json());
  app.use('/sync', createKosyncRouter(prisma));
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
    'x-auth-key': hashSyncPassword(syncPassword),
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
    await createUser(prisma, 'alice', null, ALICE_SYNC_PASSWORD);
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
    await createUser(prisma, 'alice', null, ALICE_SYNC_PASSWORD);
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

  it('returns 400, not 500, when the request carries no body at all', async () => {
    const res = await request(app).put('/sync/syncs/progress').set(authHeaders('alice', 'secret'));
    expect(res.status).toBe(400);
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
    await createUser(prisma, 'alice', null, ALICE_SYNC_PASSWORD);
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
    await createUser(prisma, 'alice', null, ALICE_SYNC_PASSWORD);
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
    await createUser(prisma, 'alice', null, ALICE_SYNC_PASSWORD);
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

describe('POST /sync/crosspoint/events', () => {
  const DOC = 'a'.repeat(32);

  function sessionEvent(overrides: Record<string, unknown> = {}) {
    return {
      schema: '1',
      event: 'reader.session',
      id: 'boot1-7',
      ts: '1760900000',
      deviceId: 'dev-uuid-1',
      pluginVersion: '0.1.0',
      firmware: '2.0.0rc',
      pluginApi: '1',
      vars: {
        book: '/Books/Dune.epub',
        document: DOC,
        start_time: '1760899000',
        end_time: '1760899600',
        duration_seconds: '600',
        start_progress_bp: '1200',
        end_progress_bp: '1450',
        progress_scale: '10000',
      },
      ...overrides,
    };
  }

  function post(body: unknown) {
    return request(app)
      .post('/sync/crosspoint/events')
      .set(authHeaders('alice', ALICE_SYNC_PASSWORD))
      .send(body as object);
  }

  beforeEach(async () => {
    await createUser(prisma, 'alice', null, ALICE_SYNC_PASSWORD);
  });

  it('returns 401 without valid credentials', async () => {
    const res = await request(app)
      .post('/sync/crosspoint/events')
      .set({ 'x-auth-user': 'alice', 'x-auth-key': 'wrong' })
      .send(sessionEvent());
    expect(res.status).toBe(401);
    expect(await prisma.readingEvent.count()).toBe(0);
  });

  it('stores the event with its full body', async () => {
    const res = await post(sessionEvent());
    expect(res.status).toBe(200);

    const alice = await prisma.user.findUnique({ where: { username: 'alice' } });
    const rows = await prisma.readingEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: alice!.id,
      deviceId: 'dev-uuid-1',
      eventId: 'boot1-7',
      event: 'reader.session',
      ts: 1760900000,
      document: DOC,
    });
    expect(JSON.parse(rows[0].body)).toEqual(sessionEvent());
  });

  it('leaves document null for events that carry no document hash', async () => {
    const res = await post(
      sessionEvent({ event: 'reader.open', vars: { book: '/Books/Dune.epub' } })
    );
    expect(res.status).toBe(200);
    const [row] = await prisma.readingEvent.findMany();
    expect(row.document).toBeNull();
  });

  it('acknowledges a redelivered event without storing it twice', async () => {
    expect((await post(sessionEvent())).status).toBe(200);
    expect((await post(sessionEvent())).status).toBe(200);
    expect(await prisma.readingEvent.count()).toBe(1);
  });

  it('stores the same event id from a different device separately', async () => {
    await post(sessionEvent());
    await post(sessionEvent({ deviceId: 'dev-uuid-2' }));
    expect(await prisma.readingEvent.count()).toBe(2);
  });

  it('acknowledges a plugin.test ping without storing it', async () => {
    const res = await post(sessionEvent({ event: 'plugin.test', vars: {} }));
    expect(res.status).toBe(200);
    expect(await prisma.readingEvent.count()).toBe(0);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app)
      .post('/sync/crosspoint/events')
      .set(authHeaders('alice', ALICE_SYNC_PASSWORD))
      .set('Content-Type', 'application/json')
      .send('{"event":"book.downloaded","vars":{"title":"The "Real" Story"}}');
    expect(res.status).toBe(400);
    expect(await prisma.readingEvent.count()).toBe(0);
  });

  it.each([
    ['event', { event: undefined }],
    ['id', { id: '' }],
    ['deviceId', { deviceId: 42 }],
    ['a numeric ts', { ts: '{event.ts}' }],
  ])('returns 400 when %s is missing or invalid', async (_label, overrides) => {
    const res = await post(sessionEvent(overrides));
    expect(res.status).toBe(400);
    expect(await prisma.readingEvent.count()).toBe(0);
  });
});

describe('sync lockout', () => {
  beforeEach(async () => {
    await createUser(prisma, 'alice', null, ALICE_SYNC_PASSWORD);
    await createUser(prisma, 'bob', null, 'bobsecret');
  });

  const wrong = (user: string) =>
    request(app).get('/sync/users/auth').set(authHeaders(user, 'nope'));

  it('10 wrong keys then 429 for that user', async () => {
    for (let i = 0; i < 10; i++) expect((await wrong('alice')).status).toBe(401);
    const res = await request(app)
      .get('/sync/users/auth')
      .set(authHeaders('alice', ALICE_SYNC_PASSWORD));
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('900');
    expect(res.body).toEqual({ error: 'Too many attempts. Try again in 15 min.' });
  });

  it('stale device for one user does not lock another user at the same IP', async () => {
    for (let i = 0; i < 10; i++) await wrong('alice');
    expect((await wrong('alice')).status).toBe(429);
    const res = await request(app).get('/sync/users/auth').set(authHeaders('bob', 'bobsecret'));
    expect(res.status).toBe(200);
  });

  it('missing headers do not count', async () => {
    for (let i = 0; i < 11; i++) {
      expect((await request(app).get('/sync/users/auth')).status).toBe(401);
    }
    const res = await request(app)
      .get('/sync/users/auth')
      .set(authHeaders('alice', ALICE_SYNC_PASSWORD));
    expect(res.status).toBe(200);
  });

  it('success clears', async () => {
    for (let i = 0; i < 9; i++) expect((await wrong('alice')).status).toBe(401);
    const ok = await request(app)
      .get('/sync/users/auth')
      .set(authHeaders('alice', ALICE_SYNC_PASSWORD));
    expect(ok.status).toBe(200);
    for (let i = 0; i < 9; i++) expect((await wrong('alice')).status).toBe(401);
  });

  const okAlice = () =>
    request(app).get('/sync/users/auth').set(authHeaders('alice', ALICE_SYNC_PASSWORD));

  it('50 wrong attempts across usernames from one address lock that address', async () => {
    for (let i = 0; i < 50; i++) expect((await wrong(`user${i}`)).status).toBe(401);
    const res = await okAlice();
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Too many attempts. Try again in 15 min.' });
  });

  it('a refusal from a locked user bucket does not count against the address', async () => {
    for (let i = 0; i < 10; i++) expect((await wrong('alice')).status).toBe(401);
    for (let i = 0; i < 20; i++) expect((await wrong('alice')).status).toBe(429);
    // 10 address failures so far; 39 more stay under the 50 lock.
    for (let i = 0; i < 39; i++) expect((await wrong(`user${i}`)).status).toBe(401);
    const res = await request(app).get('/sync/users/auth').set(authHeaders('bob', 'bobsecret'));
    expect(res.status).toBe(200);
  });

  it('another address is unaffected by a locked one', async () => {
    const proxied = express();
    proxied.use('/sync', createKosyncRouter(prisma, { trustProxyHops: 1 }));
    const from = (ip: string, user: string, password: string) =>
      request(proxied)
        .get('/sync/users/auth')
        .set('X-Forwarded-For', ip)
        .set(authHeaders(user, password));
    for (let i = 0; i < 50; i++) await from('203.0.113.1', `user${i}`, 'nope');
    expect((await from('203.0.113.1', 'alice', ALICE_SYNC_PASSWORD)).status).toBe(429);
    expect((await from('203.0.113.2', 'alice', ALICE_SYNC_PASSWORD)).status).toBe(200);
  });

  it('a 10,000-character username is a 401 and logs at most a 64-character prefix', async () => {
    const res = await wrong('x'.repeat(10_000));
    expect(res.status).toBe(401);
    const lines = authWarn.mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => line.includes(JSON.stringify('x'.repeat(64))))).toBe(true);
    expect(lines.some((line) => line.includes('x'.repeat(65)))).toBe(false);
  });

  it('a lockout keyed on a loopback address carries the TRUST_PROXY_HOPS hint', async () => {
    for (let i = 0; i < 10; i++) await wrong('alice');
    const lines = limiterWarn.mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ — every client may share this address; check TRUST_PROXY_HOPS$/);
  });
});

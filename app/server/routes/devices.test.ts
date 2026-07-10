import express, { RequestHandler } from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { runMigrations } from '../db/migrate';
import { DeviceStore } from '../services/device-store';
import { EditionStore } from '../services/edition-store';
import { createDevicesRouter } from './devices';

jest.mock('../logger');

let prisma: PrismaClient, dbPath: string, app: express.Express, editionStore: EditionStore;
const asAdmin: RequestHandler = (req, _res, next) => {
  (req as unknown as { user: { isAdmin: boolean } }).user = { isAdmin: true };
  next();
};
const asNonAdmin: RequestHandler = (req, _res, next) => {
  (req as unknown as { user: { isAdmin: boolean } }).user = { isAdmin: false };
  next();
};

beforeEach(async () => {
  const booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-'));
  dbPath = path.join(os.tmpdir(), `dv-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
  const deviceStore = new DeviceStore(prisma);
  editionStore = new EditionStore(fs.mkdtempSync(path.join(os.tmpdir(), 'edr-')), prisma);
  app = express();
  app.use(express.json());
  app.use('/api/devices', createDevicesRouter(deviceStore, editionStore, asAdmin));
});
afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
});

const body = {
  name: 'Kindle',
  coverWidth: 600,
  coverHeight: 800,
  coverFit: 'contain',
  bwCover: true,
  simplify: true,
};

it('creates and lists devices', async () => {
  const c = await request(app).post('/api/devices').send(body);
  expect(c.status).toBe(201);
  expect(c.body.slug).toBe('kindle');
  const l = await request(app).get('/api/devices');
  expect(l.body).toHaveLength(1);
});

it('rejects a name longer than 10 chars', async () => {
  const r = await request(app)
    .post('/api/devices')
    .send({ ...body, name: 'ThisIsWayTooLong' });
  expect(r.status).toBe(400);
});

it('rejects a symbol-only name that derives an empty slug', async () => {
  const r = await request(app)
    .post('/api/devices')
    .send({ ...body, name: '!!!' });
  expect(r.status).toBe(400);
});

it('rejects a duplicate slug', async () => {
  await request(app).post('/api/devices').send(body);
  const r = await request(app).post('/api/devices').send(body);
  expect(r.status).toBe(409);
});

it('updates and deletes a device', async () => {
  const c = await request(app).post('/api/devices').send(body);
  const u = await request(app)
    .patch(`/api/devices/${c.body.id}`)
    .send({ ...body, simplify: false });
  expect(u.status).toBe(200);
  expect(u.body.simplify).toBe(false);
  const d = await request(app).delete(`/api/devices/${c.body.id}`);
  expect(d.status).toBe(204);
});

it('allows non-admins to list devices but rejects non-admin mutations with 403', async () => {
  const deviceStore = new DeviceStore(prisma);
  const nonAdminApp = express();
  nonAdminApp.use(express.json());
  nonAdminApp.use('/api/devices', createDevicesRouter(deviceStore, editionStore, asNonAdmin));

  // Listing is open to any authenticated user (needed for per-device OPDS URLs).
  const list = await request(nonAdminApp).get('/api/devices');
  expect(list.status).toBe(200);

  // Mutations remain admin-only.
  const create = await request(nonAdminApp).post('/api/devices').send(body);
  expect(create.status).toBe(403);
  const patch = await request(nonAdminApp).patch('/api/devices/any-id').send(body);
  expect(patch.status).toBe(403);
  const del = await request(nonAdminApp).delete('/api/devices/any-id');
  expect(del.status).toBe(403);
});

it('purges the edition cache on PATCH and on DELETE', async () => {
  const purgeSpy = jest.spyOn(editionStore, 'purgeForDevice').mockResolvedValue(undefined);

  const c = await request(app).post('/api/devices').send(body);
  await request(app)
    .patch(`/api/devices/${c.body.id}`)
    .send({ ...body, simplify: false });
  expect(purgeSpy).toHaveBeenCalledWith(c.body.id);

  purgeSpy.mockClear();
  await request(app).delete(`/api/devices/${c.body.id}`);
  expect(purgeSpy).toHaveBeenCalledWith(c.body.id);
});

it('accepts coverFit "smart"', async () => {
  const r = await request(app)
    .post('/api/devices')
    .send({ ...body, name: 'Smart', coverFit: 'smart' });
  expect(r.status).toBe(201);
  expect(r.body.coverFit).toBe('smart');
});

it('rejects an unknown coverFit with the four-option message', async () => {
  const r = await request(app)
    .post('/api/devices')
    .send({ ...body, name: 'Bad', coverFit: 'nope' });
  expect(r.status).toBe(400);
  expect(r.body.error).toBe('coverFit must be contain, cover, smart, or fill');
});

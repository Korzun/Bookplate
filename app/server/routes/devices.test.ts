import fs from 'fs';
import os from 'os';
import path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import express, { RequestHandler } from 'express';
import request from 'supertest';

import { runMigrations } from '../db/migrate';
import { DeviceStore } from '../services/device-store';
import { EditionStore } from '../services/edition-store';
import { UserStore } from '../services/user-store';
import { createDevicesRouter } from './devices';

vi.mock('../logger');

let prisma: PrismaClient, dbPath: string, app: express.Express, editionStore: EditionStore;
let userStore: UserStore;
const asAdmin: RequestHandler = (req, _res, next) => {
  (req as unknown as { user: { isAdmin: boolean } }).user = { isAdmin: true };
  next();
};
const asNonAdmin: RequestHandler = (req, _res, next) => {
  (req as unknown as { user: { isAdmin: boolean } }).user = { isAdmin: false };
  next();
};
const asUser =
  (userId: string): RequestHandler =>
  (req, _res, next) => {
    (req as unknown as { user: { isAdmin: boolean; userId: string } }).user = {
      isAdmin: false,
      userId,
    };
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
  userStore = new UserStore(prisma);
  app = express();
  app.use(express.json());
  app.use('/api/devices', createDevicesRouter(deviceStore, editionStore, userStore, asAdmin));
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

it('rejects a name longer than 50 chars', async () => {
  const r = await request(app)
    .post('/api/devices')
    .send({ ...body, name: 'a'.repeat(51) });
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
  nonAdminApp.use(
    '/api/devices',
    createDevicesRouter(deviceStore, editionStore, userStore, asNonAdmin)
  );

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
  const purgeSpy = vi.spyOn(editionStore, 'purgeForDevice').mockResolvedValue(undefined);

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

describe('device-users management', () => {
  async function createDevice() {
    const res = await request(app).post('/api/devices').send(body);
    return res.body.id as string;
  }

  it('enables a user, lists them, and disables them', async () => {
    const id = await createDevice();
    await userStore.createUser('alice', null, 'secret');

    const put = await request(app).put(`/api/devices/${id}/users/alice`);
    expect(put.status).toBe(204);

    const list = await request(app).get(`/api/devices/${id}/users`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual(['alice']);

    const del = await request(app).delete(`/api/devices/${id}/users/alice`);
    expect(del.status).toBe(204);

    const after = await request(app).get(`/api/devices/${id}/users`);
    expect(after.body).toEqual([]);
  });

  it('PUT is idempotent', async () => {
    const id = await createDevice();
    await userStore.createUser('alice', null, 'secret');
    await request(app).put(`/api/devices/${id}/users/alice`);
    const second = await request(app).put(`/api/devices/${id}/users/alice`);
    expect(second.status).toBe(204);
    const list = await request(app).get(`/api/devices/${id}/users`);
    expect(list.body).toEqual(['alice']);
  });

  it('404s for an unknown device', async () => {
    await userStore.createUser('alice', null, 'secret');
    const res = await request(app).put('/api/devices/nope/users/alice');
    expect(res.status).toBe(404);
  });

  it('404s for an unknown username', async () => {
    const id = await createDevice();
    const res = await request(app).put(`/api/devices/${id}/users/ghost`);
    expect(res.status).toBe(404);
  });

  it('DELETE purges that user+device editions', async () => {
    const id = await createDevice();
    await userStore.createUser('alice', null, 'secret');
    await request(app).put(`/api/devices/${id}/users/alice`);
    const purgeSpy = vi.spyOn(editionStore, 'purgeForDeviceAndUser').mockResolvedValue(undefined);
    await request(app).delete(`/api/devices/${id}/users/alice`);
    expect(purgeSpy).toHaveBeenCalledWith(id, expect.any(String));
  });

  it('rejects non-admins with 403', async () => {
    const id = await createDevice();
    const deviceStore = new DeviceStore(prisma);
    const nonAdminApp = express();
    nonAdminApp.use(express.json());
    nonAdminApp.use(
      '/api/devices',
      createDevicesRouter(deviceStore, editionStore, userStore, asNonAdmin)
    );
    expect((await request(nonAdminApp).get(`/api/devices/${id}/users`)).status).toBe(403);
    expect((await request(nonAdminApp).put(`/api/devices/${id}/users/alice`)).status).toBe(403);
    expect((await request(nonAdminApp).delete(`/api/devices/${id}/users/alice`)).status).toBe(403);
  });
});

describe('GET /api/devices visibility', () => {
  it('returns all devices for an admin', async () => {
    await request(app)
      .post('/api/devices')
      .send({ ...body, name: 'Kindle' });
    await request(app)
      .post('/api/devices')
      .send({ ...body, name: 'Kobo' });
    const res = await request(app).get('/api/devices');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('returns only enabled devices for a regular user', async () => {
    const kindle = (
      await request(app)
        .post('/api/devices')
        .send({ ...body, name: 'Kindle' })
    ).body;
    await request(app)
      .post('/api/devices')
      .send({ ...body, name: 'Kobo' });
    await userStore.createUser('alice', null, 'secret');
    const aliceId = (await userStore.getUserIdByUsername('alice'))!;
    await request(app).put(`/api/devices/${kindle.id}/users/alice`);

    const deviceStore = new DeviceStore(prisma);
    const userApp = express();
    userApp.use(express.json());
    userApp.use(
      '/api/devices',
      createDevicesRouter(deviceStore, editionStore, userStore, asUser(aliceId))
    );

    const res = await request(userApp).get('/api/devices');
    expect(res.status).toBe(200);
    expect(res.body.map((d: { name: string }) => d.name)).toEqual(['Kindle']);
  });
});

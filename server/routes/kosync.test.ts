import Database from 'better-sqlite3';
import request from 'supertest';
import express from 'express';
import { UserStore } from '../services/user-store';
import { createKosyncRouter } from './kosync';

jest.mock('../logger');

let db: InstanceType<typeof Database>;
let userStore: UserStore;
let app: express.Express;

beforeEach(() => {
  db = new Database(':memory:');
  userStore = new UserStore(db);
  app = express();
  app.use(express.json());
  app.use('/kosync', createKosyncRouter(userStore));
});

afterEach(() => {
  db.close();
});

function authHeaders(username: string, password: string) {
  return {
    'x-auth-user': username,
    'x-auth-key': UserStore.hashPassword(password),
  };
}

// KoReader sends MD5(password) in the registration body, not the raw password.
function registerBody(username: string, password: string) {
  return { username, password: UserStore.hashPassword(password) };
}

describe('POST /kosync/users/create', () => {
  it('returns 201 and username on success', async () => {
    const res = await request(app)
      .post('/kosync/users/create')
      .send(registerBody('alice', 'secret'));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ username: 'alice' });
  });

  it('returns 402 on duplicate username', async () => {
    await request(app).post('/kosync/users/create').send(registerBody('alice', 'secret'));
    const res = await request(app)
      .post('/kosync/users/create')
      .send(registerBody('alice', 'other'));
    expect(res.status).toBe(402);
    expect(res.body).toEqual({ username: null });
  });

  it('returns 400 when username or password missing', async () => {
    const res = await request(app).post('/kosync/users/create').send({ username: 'alice' });
    expect(res.status).toBe(400);
  });
});

describe('GET /kosync/users/auth', () => {
  beforeEach(async () => {
    await request(app).post('/kosync/users/create').send(registerBody('alice', 'secret'));
  });

  it('returns 200 with correct credentials', async () => {
    const res = await request(app).get('/kosync/users/auth').set(authHeaders('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authorized: 'OK' });
  });

  it('returns 401 with wrong password', async () => {
    const res = await request(app)
      .get('/kosync/users/auth')
      .set({ 'x-auth-user': 'alice', 'x-auth-key': 'badsecret' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with missing headers', async () => {
    const res = await request(app).get('/kosync/users/auth');
    expect(res.status).toBe(401);
  });
});

describe('PUT /kosync/syncs/progress', () => {
  beforeEach(async () => {
    await request(app).post('/kosync/users/create').send(registerBody('alice', 'secret'));
  });

  it('saves progress and returns document + timestamp', async () => {
    const res = await request(app)
      .put('/kosync/syncs/progress')
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
      .put('/kosync/syncs/progress')
      .set(authHeaders('alice', 'secret'))
      .send({ document: 'docHash123' });
    expect(res.status).toBe(400);
  });
});

describe('GET /kosync/syncs/progress/:document', () => {
  beforeEach(async () => {
    await request(app).post('/kosync/users/create').send(registerBody('alice', 'secret'));
    await request(app).put('/kosync/syncs/progress').set(authHeaders('alice', 'secret')).send({
      document: 'docHash123',
      progress: '/body/DocFragment[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'dev-1',
    });
  });

  it('returns saved progress', async () => {
    const res = await request(app)
      .get('/kosync/syncs/progress/docHash123')
      .set(authHeaders('alice', 'secret'));
    expect(res.status).toBe(200);
    expect(res.body.progress).toBe('/body/DocFragment[5]');
    expect(res.body.percentage).toBeCloseTo(0.42);
  });

  it('returns 404 for unknown document', async () => {
    const res = await request(app)
      .get('/kosync/syncs/progress/unknown')
      .set(authHeaders('alice', 'secret'));
    expect(res.status).toBe(404);
  });
});

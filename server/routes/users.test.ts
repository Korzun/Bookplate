import request from 'supertest';
import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import { UserStore } from '../services/user-store';
import { createUsersRouter } from './users';

jest.mock('../logger');

let db: InstanceType<typeof Database>;
let userStore: UserStore;
let app: express.Express;

beforeEach(() => {
  db = new Database(':memory:');
  userStore = new UserStore(db);

  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  // Minimal login endpoints for test session setup
  app.post('/login/admin', (req, res) => {
    req.session.authenticated = true;
    req.session.isAdmin = true;
    res.status(200).send('ok');
  });
  app.post('/login/user', (req, res) => {
    req.session.authenticated = true;
    req.session.isAdmin = false;
    res.status(200).send('ok');
  });
  app.use('/api/users', createUsersRouter(userStore, 'admin'));
});

afterEach(() => {
  db.close();
});

async function adminAgent() {
  const agent = request.agent(app);
  await agent.post('/login/admin');
  return agent;
}

async function userAgent() {
  const agent = request.agent(app);
  await agent.post('/login/user');
  return agent;
}

describe('GET /api/users', () => {
  it('redirects to /login without session', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(302);
  });

  it('returns empty array when no users', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns users with progress counts', async () => {
    userStore.createUser('alice', 'pass');
    userStore.saveProgress('alice', {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await adminAgent();
    const res = await agent.get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].username).toBe('alice');
    expect(res.body[0].progressCount).toBe(1);
  });
});

describe('GET /api/users/:username/progress', () => {
  it('redirects to /login without session', async () => {
    const res = await request(app).get('/api/users/alice/progress');
    expect(res.status).toBe(302);
  });

  it('returns 404 for unknown user', async () => {
    const agent = await adminAgent();
    const res = await agent.get('/api/users/nobody/progress');
    expect(res.status).toBe(404);
  });

  it('returns empty array for user with no progress', async () => {
    userStore.createUser('alice', 'pass');
    const agent = await adminAgent();
    const res = await agent.get('/api/users/alice/progress');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns progress records for a user', async () => {
    userStore.createUser('alice', 'pass');
    userStore.saveProgress('alice', {
      document: 'dune.epub',
      progress: '/p[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await adminAgent();
    const res = await agent.get('/api/users/alice/progress');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].document).toBe('dune.epub');
    expect(res.body[0].percentage).toBeCloseTo(0.42);
  });
});

describe('DELETE /api/users/:username', () => {
  it('redirects to /login without session', async () => {
    const res = await request(app).delete('/api/users/alice');
    expect(res.status).toBe(302);
  });

  it('returns 404 for unknown user', async () => {
    const agent = await adminAgent();
    const res = await agent.delete('/api/users/nobody');
    expect(res.status).toBe(404);
  });

  it('deletes the user and returns 204', async () => {
    userStore.createUser('alice', 'pass');
    const agent = await adminAgent();
    const res = await agent.delete('/api/users/alice');
    expect(res.status).toBe(204);
    expect(userStore.userExists('alice')).toBe(false);
  });

  it('cascades to delete progress records', async () => {
    userStore.createUser('alice', 'pass');
    userStore.saveProgress('alice', {
      document: 'doc1',
      progress: '/p[1]',
      percentage: 0.5,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await adminAgent();
    await agent.delete('/api/users/alice');
    expect(userStore.getUserProgress('alice')).toEqual([]);
  });
});

describe('POST /api/users', () => {
  it('redirects to /login without session', async () => {
    const res = await request(app).post('/api/users').send({ username: 'bob', password: 'pass' });
    expect(res.status).toBe(302);
  });

  it('creates a user and returns 201', async () => {
    const agent = await adminAgent();
    const res = await agent.post('/api/users').send({ username: 'bob', password: 'secret' });
    expect(res.status).toBe(201);
    expect(res.body.username).toBe('bob');
    expect(userStore.userExists('bob')).toBe(true);
    expect(userStore.authenticate('bob', UserStore.hashPassword('secret'))).toBe(true);
  });

  it('returns 409 for duplicate username', async () => {
    userStore.createUser('bob', UserStore.hashPassword('pass'));
    const agent = await adminAgent();
    const res = await agent.post('/api/users').send({ username: 'bob', password: 'other' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Username already exists');
  });

  it('returns 400 when username is missing', async () => {
    const agent = await adminAgent();
    const res = await agent.post('/api/users').send({ password: 'pass' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and password are required');
  });

  it('returns 400 when password is missing', async () => {
    const agent = await adminAgent();
    const res = await agent.post('/api/users').send({ username: 'bob' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and password are required');
  });

  it('returns 400 when username is blank', async () => {
    const agent = await adminAgent();
    const res = await agent.post('/api/users').send({ username: '   ', password: 'pass' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and password are required');
  });

  it('returns 400 when password is blank', async () => {
    const agent = await adminAgent();
    const res = await agent.post('/api/users').send({ username: 'bob', password: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Username and password are required');
  });

  it('returns 409 when username matches admin', async () => {
    const agent = await adminAgent();
    const res = await agent.post('/api/users').send({ username: 'admin', password: 'anything' });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/users/:username/progress/:document', () => {
  it('redirects to /login without session', async () => {
    const res = await request(app).delete('/api/users/alice/progress/doc1');
    expect(res.status).toBe(302);
  });

  it('returns 404 when user does not exist', async () => {
    const agent = await adminAgent();
    const res = await agent.delete('/api/users/nobody/progress/doc1');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('returns 404 when user exists but has no progress for that document', async () => {
    userStore.createUser('alice', 'pass');
    const agent = await adminAgent();
    const res = await agent.delete('/api/users/alice/progress/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Progress record not found');
  });

  it('clears the progress record and returns 204', async () => {
    userStore.createUser('alice', 'pass');
    userStore.saveProgress('alice', {
      document: 'dune.epub',
      progress: '/p[5]',
      percentage: 0.42,
      device: 'Kobo',
      device_id: 'd1',
    });
    const agent = await adminAgent();
    const res = await agent.delete('/api/users/alice/progress/dune.epub');
    expect(res.status).toBe(204);
    expect(userStore.getProgress('alice', 'dune.epub')).toBeNull();
  });
});

describe('RBAC — regular user is forbidden from all /api/users routes', () => {
  it('GET /api/users returns 403 for regular user', async () => {
    const agent = await userAgent();
    const res = await agent.get('/api/users');
    expect(res.status).toBe(403);
  });

  it('POST /api/users returns 403 for regular user', async () => {
    const agent = await userAgent();
    const res = await agent.post('/api/users').send({ username: 'bob', password: 'pass' });
    expect(res.status).toBe(403);
  });

  it('DELETE /api/users/:username returns 403 for regular user', async () => {
    userStore.createUser('victim', 'pass');
    const agent = await userAgent();
    const res = await agent.delete('/api/users/victim');
    expect(res.status).toBe(403);
  });

  it('GET /api/users/:username/progress returns 403 for regular user', async () => {
    userStore.createUser('alice', 'pass');
    const agent = await userAgent();
    const res = await agent.get('/api/users/alice/progress');
    expect(res.status).toBe(403);
  });

  it('DELETE /api/users/:username/progress/:document returns 403 for regular user', async () => {
    userStore.createUser('alice', 'pass');
    const agent = await userAgent();
    const res = await agent.delete('/api/users/alice/progress/doc1');
    expect(res.status).toBe(403);
  });
});

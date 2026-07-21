import * as crypto from 'crypto';

import express from 'express';
import request from 'supertest';

import { signAccessToken } from '../services/jwt';
import { jwtAuth, adminAuth, passwordChangeGate } from './auth';

vi.mock('../logger');

const secret = crypto.randomBytes(32);

const userToken = signAccessToken(secret, {
  userId: 'u1',
  username: 'alice',
  isAdmin: false,
  mustChangePassword: false,
});
const adminToken = signAccessToken(secret, {
  username: 'admin',
  isAdmin: true,
  mustChangePassword: false,
});
const mustChangeToken = signAccessToken(secret, {
  userId: 'u1',
  username: 'alice',
  isAdmin: false,
  mustChangePassword: true,
});

function buildApp() {
  const app = express();
  app.use(passwordChangeGate(secret));
  app.get('/api/whoami', jwtAuth(secret), (req, res) => {
    res.json(req.user);
  });
  app.get('/api/admin-only', jwtAuth(secret), adminAuth, (_req, res) => {
    res.json({ ok: true });
  });
  app.patch('/api/my/password', jwtAuth(secret), (_req, res) => res.status(200).json({}));
  app.post('/api/auth/refresh', (_req, res) => res.status(200).json({}));
  app.post('/api/login', (_req, res) => res.status(200).json({}));
  app.get('/anything', (_req, res) => res.status(200).send('spa'));
  return app;
}

describe('jwtAuth', () => {
  it('rejects a missing Authorization header with 401', async () => {
    const res = await request(buildApp()).get('/api/whoami');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('rejects a malformed header with 401', async () => {
    const res = await request(buildApp()).get('/api/whoami').set('Authorization', 'Basic abc123');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token with 401', async () => {
    const res = await request(buildApp())
      .get('/api/whoami')
      .set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(401);
  });

  it('attaches req.user for a valid token', async () => {
    const res = await request(buildApp())
      .get('/api/whoami')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      userId: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
  });
});

describe('adminAuth', () => {
  it('rejects a non-admin with 403', async () => {
    const res = await request(buildApp())
      .get('/api/admin-only')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('allows an admin', async () => {
    const res = await request(buildApp())
      .get('/api/admin-only')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe('passwordChangeGate', () => {
  it('blocks API requests when mustChangePassword is set', async () => {
    const res = await request(buildApp())
      .get('/api/whoami')
      .set('Authorization', `Bearer ${mustChangeToken}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Password change required' });
  });

  it('allows the password-change endpoint itself', async () => {
    const res = await request(buildApp())
      .patch('/api/my/password')
      .set('Authorization', `Bearer ${mustChangeToken}`);
    expect(res.status).toBe(200);
  });

  it('allows /api/auth/* and /api/login', async () => {
    const refresh = await request(buildApp())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${mustChangeToken}`);
    expect(refresh.status).toBe(200);
    const login = await request(buildApp())
      .post('/api/login')
      .set('Authorization', `Bearer ${mustChangeToken}`);
    expect(login.status).toBe(200);
  });

  it('allows non-API paths (SPA assets/pages)', async () => {
    const res = await request(buildApp())
      .get('/anything')
      .set('Authorization', `Bearer ${mustChangeToken}`);
    expect(res.status).toBe(200);
  });

  it('passes through requests without a token (route auth handles them)', async () => {
    const res = await request(buildApp()).post('/api/login');
    expect(res.status).toBe(200);
  });
});

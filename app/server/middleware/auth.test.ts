import * as crypto from 'crypto';

import express from 'express';
import request from 'supertest';

import { signAccessToken } from '../services/jwt';
import { emailSetupGate, jwtAuth, passwordChangeGate } from './auth';

vi.mock('../logger');

const secret = crypto.randomBytes(32);

const userToken = signAccessToken(secret, {
  userId: 'u1',
  username: 'alice',
  isAdmin: false,
  mustChangePassword: false,
  mustSetEmail: false,
});
const mustChangeToken = signAccessToken(secret, {
  userId: 'u1',
  username: 'alice',
  isAdmin: false,
  mustChangePassword: true,
  mustSetEmail: false,
});

function buildApp() {
  const app = express();
  app.use(passwordChangeGate(secret));
  app.use(emailSetupGate(secret));
  app.get('/api/whoami', jwtAuth(secret), (req, res) => {
    res.json(req.user);
  });
  app.all('/api/anything', jwtAuth(secret), (req, res) => {
    res.json(req.user);
  });
  app.post('/api/auth/refresh', (_req, res) => res.status(200).json({}));
  app.post('/api/login', (_req, res) => res.status(200).json({}));
  app.post('/api/password/forgot', (_req, res) => res.status(200).json({}));
  app.post('/api/password/reset', (_req, res) => res.status(200).json({}));
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
      mustSetEmail: false,
    });
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

  // `PATCH /api/my/password` was exempt here until the route was retired.
  // The exemption went with it, so a locked-out caller now gets the same 403
  // at that path as at any other `/api/*` path that matches no route.
  it('no longer exempts the retired password-change path', async () => {
    const res = await request(buildApp())
      .patch('/api/my/password')
      .set('Authorization', `Bearer ${mustChangeToken}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Password change required' });
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

  it('allows /api/password/* — the unauthenticated reset flow', async () => {
    const forgot = await request(buildApp())
      .post('/api/password/forgot')
      .set('Authorization', `Bearer ${mustChangeToken}`);
    expect(forgot.status).toBe(200);
    const reset = await request(buildApp())
      .post('/api/password/reset')
      .set('Authorization', `Bearer ${mustChangeToken}`);
    expect(reset.status).toBe(200);
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

  it('sends a viewer with both pending flags to the password gate first', async () => {
    const bothToken = signAccessToken(secret, {
      userId: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: true,
      mustSetEmail: true,
    });
    const res = await request(buildApp())
      .get('/api/whoami')
      .set('Authorization', `Bearer ${bothToken}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Password change required' });
  });
});

describe('emailSetupGate', () => {
  it('rejects an API request from a viewer who must set an email', async () => {
    const token = signAccessToken(secret, {
      username: 'ann',
      isAdmin: false,
      mustChangePassword: false,
      mustSetEmail: true,
    });
    const res = await request(buildApp())
      .get('/api/anything')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Email required');
  });

  it('allows a viewer who has one', async () => {
    const token = signAccessToken(secret, {
      username: 'ann',
      isAdmin: false,
      mustChangePassword: false,
      mustSetEmail: false,
    });
    const res = await request(buildApp())
      .get('/api/anything')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).not.toBe(403);
  });

  it.each(['/api/login', '/api/auth/refresh', '/api/password/forgot', '/api/password/reset'])(
    'never gates %s',
    async (path) => {
      const token = signAccessToken(secret, {
        username: 'ann',
        isAdmin: false,
        mustChangePassword: false,
        mustSetEmail: true,
      });
      const res = await request(buildApp())
        .post(path)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).not.toBe(403);
    }
  );

  it('passes through a request with no token, leaving 401 to jwtAuth', async () => {
    const res = await request(buildApp()).get('/api/anything');
    expect(res.status).toBe(401);
  });
});

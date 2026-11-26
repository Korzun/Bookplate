import express from 'express';
import request from 'supertest';

import {
  createLoginLimiter,
  LIMITER_MAX_ENTRIES,
  sendBusy,
  sendLocked,
  WEB_LOCKOUT,
  type LoginLimiter,
} from './login-limiter';

let t = 0;
const now = () => t;

function make(maxEntries?: number): LoginLimiter {
  return createLoginLimiter({ now, ...WEB_LOCKOUT, label: 'Test', maxEntries });
}

function fail(limiter: LoginLimiter, key: string, times: number) {
  return Array.from({ length: times }, () => limiter.begin(key, key));
}

describe('createLoginLimiter', () => {
  beforeEach(() => {
    t = 0;
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('locks after 5 failures', () => {
    const limiter = make();
    fail(limiter, 'a', 5);
    expect(limiter.lockedForMs('a')).toBe(900_000);
    expect(limiter.lockedForMs('b')).toBeNull();
  });

  it('stays unlocked at 4 failures', () => {
    const limiter = make();
    fail(limiter, 'a', 4);
    expect(limiter.lockedForMs('a')).toBeNull();
  });

  it('unlocks 15 min after the lock began', () => {
    const limiter = make();
    fail(limiter, 'a', 5);
    t = 899_999;
    expect(limiter.lockedForMs('a')).toBe(1);
    t = 900_000;
    expect(limiter.lockedForMs('a')).toBeNull();
    limiter.begin('a', 'a');
    expect(limiter.lockedForMs('a')).toBeNull();
  });

  it('failures older than the window drop off', () => {
    const limiter = make();
    fail(limiter, 'a', 4);
    t = 900_000;
    limiter.begin('a', 'a');
    expect(limiter.lockedForMs('a')).toBeNull();
  });

  it('counts provisional failures under a burst', () => {
    const limiter = make();
    fail(limiter, 'a', 5);
    expect(limiter.lockedForMs('a')).toBe(900_000);
  });

  it('success clears failures and the lock', () => {
    const limiter = make();
    const attempts = fail(limiter, 'a', 5);
    attempts[4].succeeded();
    expect(limiter.lockedForMs('a')).toBeNull();
    fail(limiter, 'a', 4);
    expect(limiter.lockedForMs('a')).toBeNull();
  });

  it('cancelled removes one failure and undoes a lock it alone started', () => {
    const limiter = make();
    const attempts = fail(limiter, 'a', 5);
    attempts[4].cancelled();
    expect(limiter.lockedForMs('a')).toBeNull();
    limiter.begin('a', 'a');
    expect(limiter.lockedForMs('a')).toBe(900_000);
  });

  it('cancelled twice removes only one failure', () => {
    const limiter = make();
    const attempts = fail(limiter, 'a', 5);
    attempts[4].cancelled();
    attempts[4].cancelled();
    limiter.begin('a', 'a');
    expect(limiter.lockedForMs('a')).toBe(900_000);
  });

  it('cancelled after succeeded is a no-op', () => {
    const limiter = make();
    const a = limiter.begin('a', 'a');
    a.succeeded();
    fail(limiter, 'a', 4);
    a.cancelled();
    limiter.begin('a', 'a');
    expect(limiter.lockedForMs('a')).toBe(900_000);
  });

  it('logs one warn when a lock begins, not per refused check', () => {
    const write = vi.mocked(process.stderr.write);
    const limiter = make();
    for (let i = 0; i < 5; i++) limiter.begin('ip:secret-part', 'who-1');
    for (let i = 0; i < 3; i++) limiter.lockedForMs('ip:secret-part');
    expect(write).toHaveBeenCalledTimes(1);
    const line = String(write.mock.calls[0][0]);
    expect(line).toContain('Test');
    expect(line).toContain('who-1');
    expect(line).not.toContain('secret-part');
  });

  it('sweep bounds memory', () => {
    const limiter = make();
    for (let i = 0; i < 300; i++) limiter.begin(`k${i}`, 'x');
    t = 900_001;
    limiter.begin('late', 'x');
    expect(limiter.size()).toBe(1);
  });

  it('sweeps at most once a second', () => {
    const limiter = make();
    limiter.begin('a', 'x');
    t = 899_500;
    limiter.begin('b', 'x');
    // 'a' is past the window from here on, but the last sweep was 900 ms ago.
    t = 900_400;
    limiter.begin('c', 'x');
    expect(limiter.size()).toBe(3);
    t = 900_500;
    limiter.begin('d', 'x');
    expect(limiter.size()).toBe(3);
  });

  it('caps entries at LIMITER_MAX_ENTRIES', () => {
    expect(LIMITER_MAX_ENTRIES).toBe(10_000);
    const limiter = make();
    for (let i = 0; i < 20_000; i++) limiter.begin(`k${i}`, 'x');
    expect(limiter.size()).toBeLessThanOrEqual(10_000);
  });

  it('never evicts a live lock, even past the cap', () => {
    const limiter = make(5);
    for (let k = 0; k < 5; k++) fail(limiter, `lock${k}`, 5);
    limiter.begin('new', 'x');
    expect(limiter.size()).toBe(6);
    for (let k = 0; k < 5; k++) expect(limiter.lockedForMs(`lock${k}`)).toBe(900_000);
  });

  it('evicts the oldest unlocked entry first', () => {
    const limiter = make(3);
    fail(limiter, 'L', 5);
    fail(limiter, 'a', 4);
    fail(limiter, 'b', 4);
    // At the cap: 'a' is the oldest entry without a lock.
    limiter.begin('c', 'x');
    limiter.begin('b', 'x');
    expect(limiter.lockedForMs('b')).toBe(900_000);
    // At the cap again: 'c' goes now, so 'a' starts over at one failure.
    limiter.begin('a', 'x');
    expect(limiter.lockedForMs('a')).toBeNull();
    expect(limiter.lockedForMs('L')).toBe(900_000);
  });

  it('appends the hint to the lockout warn line', () => {
    const write = vi.mocked(process.stderr.write);
    const limiter = make();
    for (let i = 0; i < 5; i++) limiter.begin('k', 'who-1', ' — the hint');
    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0][0]).trimEnd()).toMatch(/failures — the hint$/);
  });
});

describe('sendLocked', () => {
  it('answers 429 with Retry-After in seconds and minutes rounded up', async () => {
    const app = express();
    app.get('/', (_req, res) => sendLocked(res, 61_000));
    const res = await request(app).get('/');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('61');
    expect(res.body).toEqual({ error: 'Too many attempts. Try again in 2 min.' });
  });
});

describe('sendBusy', () => {
  it('answers 429 busy and logs one warn', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const app = express();
      app.get('/', (_req, res) => sendBusy(res, 'who-1', 'Test'));
      const res = await request(app).get('/');
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBe('60');
      expect(res.body).toEqual({ error: 'Server busy. Try again in a minute.' });
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
    }
  });
});

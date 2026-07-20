import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { makeJwt } from './test-jwt';
import {
  AuthClaims,
  TOKEN_CHANGED_EVENT,
  clearToken,
  currentIdentity,
  decodeClaims,
  extractAccessToken,
  getToken,
  isExpired,
  setToken,
} from './token';

afterEach(() => {
  localStorage.clear();
});

describe('get/set/clearToken', () => {
  it('round-trips through localStorage', () => {
    expect(getToken()).toBeNull();
    setToken('abc');
    expect(getToken()).toBe('abc');
    clearToken();
    expect(getToken()).toBeNull();
  });

  it('dispatches a change event on set and clear', () => {
    const listener = vi.fn();
    window.addEventListener(TOKEN_CHANGED_EVENT, listener);
    setToken('abc');
    clearToken();
    window.removeEventListener(TOKEN_CHANGED_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('decodeClaims', () => {
  it('decodes a user token', () => {
    const token = makeJwt({
      sub: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: true,
      exp: 1760000900,
    });
    expect(decodeClaims(token)).toEqual({
      userId: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: true,
      exp: 1760000900,
    });
  });

  it('omits userId when sub is absent (admin token)', () => {
    const claims = decodeClaims(
      makeJwt({ username: 'admin', isAdmin: true, mustChangePassword: false, exp: 1760000900 })
    );
    expect(claims).not.toBeNull();
    expect(claims).not.toHaveProperty('userId');
    expect(claims!.isAdmin).toBe(true);
  });

  it('returns null for malformed input', () => {
    expect(decodeClaims('')).toBeNull();
    expect(decodeClaims('one.two')).toBeNull();
    expect(decodeClaims('a.%%%.c')).toBeNull();
    expect(decodeClaims(`x.${btoa('"not an object"')}.y`)).toBeNull();
    expect(decodeClaims(makeJwt({ isAdmin: true, exp: 1 }))).toBeNull(); // no username
    expect(decodeClaims(makeJwt({ username: 'a' }))).toBeNull(); // no exp
  });

  it('returns null when boolean claims are missing or mistyped', () => {
    expect(decodeClaims(makeJwt({ username: 'a', exp: 1, mustChangePassword: false }))).toBeNull();
    expect(decodeClaims(makeJwt({ username: 'a', exp: 1, isAdmin: false }))).toBeNull();
    expect(
      decodeClaims(makeJwt({ username: 'a', exp: 1, isAdmin: 'yes', mustChangePassword: false }))
    ).toBeNull();
  });

  it('decodes non-ASCII claim values correctly', () => {
    const claims = decodeClaims(
      makeJwt({
        username: 'Simön Körzün',
        isAdmin: false,
        mustChangePassword: false,
        exp: 1760000900,
      })
    );
    expect(claims!.username).toBe('Simön Körzün');
  });
});

describe('extractAccessToken', () => {
  it('returns the string for a well-shaped body', () => {
    expect(extractAccessToken({ accessToken: 'a.b.c' })).toBe('a.b.c');
  });

  it('returns null for malformed bodies', () => {
    expect(extractAccessToken({})).toBeNull();
    expect(extractAccessToken(null)).toBeNull();
    expect(extractAccessToken('x')).toBeNull();
    expect(extractAccessToken({ accessToken: 42 })).toBeNull();
    expect(extractAccessToken({ accessToken: '' })).toBeNull();
  });
});

describe('isExpired', () => {
  const claims = (exp: number): AuthClaims => ({
    username: 'alice',
    isAdmin: false,
    mustChangePassword: false,
    exp,
  });

  it('is false before exp and true after', () => {
    expect(isExpired(claims(Math.floor(Date.now() / 1000) + 60))).toBe(false);
    expect(isExpired(claims(Math.floor(Date.now() / 1000) - 60))).toBe(true);
  });
});

describe('currentIdentity', () => {
  it('is null when logged out', () => {
    expect(currentIdentity()).toBeNull();
  });

  it('prefers the user id (sub) when present', () => {
    setToken(
      makeJwt({
        sub: 'u1',
        username: 'alice',
        isAdmin: false,
        mustChangePassword: false,
        exp: 9999999999,
      })
    );
    expect(currentIdentity()).toBe('u1');
  });

  it('falls back to username for the config admin (no sub)', () => {
    setToken(
      makeJwt({ username: 'admin', isAdmin: true, mustChangePassword: false, exp: 9999999999 })
    );
    expect(currentIdentity()).toBe('admin');
  });

  it('is null when the token is malformed', () => {
    setToken('not-a-jwt');
    expect(currentIdentity()).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AuthClaims,
  TOKEN_CHANGED_EVENT,
  clearToken,
  decodeClaims,
  getToken,
  isExpired,
  setToken,
} from './token';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const makeJwt = (payload: Record<string, unknown>) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.fake-signature`;

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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch, ensureFreshToken, refreshAccessToken } from './api-fetch';
import { makeJwt } from './test-jwt';
import { getToken, setToken } from './token';

const validToken = makeJwt({
  sub: 'u1',
  username: 'alice',
  isAdmin: false,
  mustChangePassword: false,
  exp: Math.floor(Date.now() / 1000) + 900,
});

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const jsonResponse = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

const callHeaders = (n: number) => new Headers((fetchMock.mock.calls[n][1] as RequestInit).headers);

describe('apiFetch', () => {
  it('adds the Authorization header when a token is stored', async () => {
    setToken(validToken);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    await apiFetch('/api/books');
    expect(fetchMock).toHaveBeenCalledWith('/api/books', expect.objectContaining({}));
    expect(callHeaders(0).get('Authorization')).toBe(`Bearer ${validToken}`);
  });

  it('preserves caller init and headers', async () => {
    setToken(validToken);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiFetch('/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(fetchMock).toHaveBeenCalledWith('/api/x', expect.objectContaining({ method: 'POST' }));
    expect(callHeaders(0).get('Authorization')).toBe(`Bearer ${validToken}`);
    expect(callHeaders(0).get('Content-Type')).toBe('application/json');
  });

  it('sends no header when no token is stored', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiFetch('/api/books');
    expect(fetchMock).toHaveBeenCalledWith('/api/books', {});
  });

  it('on 401, refreshes once and retries with the new token', async () => {
    setToken(validToken);
    const newToken = makeJwt({
      sub: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401)) // original request
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: newToken })) // refresh
      .mockResolvedValueOnce(jsonResponse(200, [])); // retry
    const res = await apiFetch('/api/books');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/auth/refresh', { method: 'POST' });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/books', expect.objectContaining({}));
    expect(callHeaders(2).get('Authorization')).toBe(`Bearer ${newToken}`);
    expect(getToken()).toBe(newToken);
  });

  it('returns the original 401 and clears the token when refresh fails', async () => {
    setToken(validToken);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401)) // original request
      .mockResolvedValueOnce(jsonResponse(401)); // refresh
    const res = await apiFetch('/api/books');
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no retry
    expect(getToken()).toBeNull();
  });
});

describe('refreshAccessToken', () => {
  it('stores the new token on success', async () => {
    const newToken = 'header.payload.sig';
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: newToken }));
    expect(await refreshAccessToken()).toBe(true);
    expect(getToken()).toBe(newToken);
  });

  it('deduplicates concurrent refreshes (single-flight)', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (release = resolve)));
    const a = refreshAccessToken();
    const b = refreshAccessToken();
    release(jsonResponse(200, { accessToken: 'tok.en.x' }));
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns false but keeps the token on a network error', async () => {
    setToken(validToken);
    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    expect(await refreshAccessToken()).toBe(false);
    expect(getToken()).toBe(validToken);
  });

  it('returns false but keeps the token on a 5xx response', async () => {
    setToken(validToken);
    fetchMock.mockResolvedValueOnce(jsonResponse(503));
    expect(await refreshAccessToken()).toBe(false);
    expect(getToken()).toBe(validToken);
  });

  it('clears the token only on an explicit 401 rejection', async () => {
    setToken(validToken);
    fetchMock.mockResolvedValueOnce(jsonResponse(401));
    expect(await refreshAccessToken()).toBe(false);
    expect(getToken()).toBeNull();
  });
});

describe('refreshAccessToken — two-tab refresh race (regression)', () => {
  // Reproduces the logout bug: two tabs (modelled as separate module instances,
  // so each has its own single-flight state) both refresh near expiry. The
  // server rotates the refresh token and consumes it exactly once, so a second
  // concurrent presentation is a rejected replay (401). Without cross-tab
  // coordination the losing tab treated that 401 as a logout — clearing the
  // shared token (and, server-side, the refresh cookie) and logging every tab
  // out. A browser-wide Web Lock must serialize the tabs so the second adopts
  // the token the first stored instead of spending its rotated-out one.

  type Tab = typeof import('./api-fetch');

  // Minimal stand-in for the Web Locks API: serializes callbacks per lock name
  // (jsdom provides no navigator.locks). Shared via the global navigator, so
  // both module instances coordinate through it like real same-origin tabs.
  const makeLockManager = () => {
    const tails = new Map<string, Promise<unknown>>();
    return {
      request: <T>(name: string, callback: () => Promise<T>): Promise<T> => {
        const prev = tails.get(name) ?? Promise.resolve();
        const result = prev.then(
          () => callback(),
          () => callback()
        );
        tails.set(
          name,
          result.then(
            () => undefined,
            () => undefined
          )
        );
        return result;
      },
    };
  };

  const loadTab = async (): Promise<Tab> => {
    vi.resetModules();
    return import('./api-fetch');
  };

  beforeEach(() => {
    Object.defineProperty(navigator, 'locks', { value: makeLockManager(), configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks');
  });

  it('serializes the tabs so the second adopts the new token instead of logging out', async () => {
    const claims = { sub: 'u1', username: 'alice', isAdmin: false, mustChangePassword: false };
    const nearExpiry = makeJwt({ ...claims, exp: Math.floor(Date.now() / 1000) + 30 });
    const rotated = makeJwt({ ...claims, exp: Math.floor(Date.now() / 1000) + 900 });
    setToken(nearExpiry);

    // Server consumes the rotating refresh token exactly once, mirroring
    // tokenStore.consumeRefreshToken: the first presentation rotates to a new
    // token; any later presentation is a rejected replay (401).
    let consumed = false;
    fetchMock.mockImplementation(() => {
      if (consumed) return Promise.resolve(jsonResponse(401));
      consumed = true;
      return Promise.resolve(jsonResponse(200, { accessToken: rotated }));
    });

    const tabA = await loadTab();
    const tabB = await loadTab();

    const results = await Promise.all([tabA.refreshAccessToken(), tabB.refreshAccessToken()]);

    expect(results).toEqual([true, true]); // neither tab considered itself logged out
    expect(fetchMock).toHaveBeenCalledTimes(1); // the refresh token was spent only once
    expect(getToken()).toBe(rotated); // the loser kept the fresh token, never cleared it
  });
});

describe('ensureFreshToken', () => {
  it('returns the current token without fetching when exp is far out', async () => {
    setToken(validToken);
    expect(await ensureFreshToken()).toBe(validToken);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes and returns the new token when the current one is expired', async () => {
    const expired = makeJwt({
      sub: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    setToken(expired);
    const newToken = makeJwt({
      sub: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: newToken }));
    expect(await ensureFreshToken()).toBe(newToken);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', { method: 'POST' });
  });

  it('returns null when there is no token and refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401));
    expect(await ensureFreshToken()).toBeNull();
  });
});

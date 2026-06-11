import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch, refreshAccessToken } from './api-fetch';
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

describe('apiFetch', () => {
  it('adds the Authorization header when a token is stored', async () => {
    setToken(validToken);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    await apiFetch('/api/books');
    expect(fetchMock).toHaveBeenCalledWith('/api/books', {
      headers: { Authorization: `Bearer ${validToken}` },
    });
  });

  it('preserves caller init and headers', async () => {
    setToken(validToken);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await apiFetch('/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(fetchMock).toHaveBeenCalledWith('/api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${validToken}` },
    });
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
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/books', {
      headers: { Authorization: `Bearer ${newToken}` },
    });
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

  it('returns false and clears the token on a network error', async () => {
    setToken(validToken);
    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    expect(await refreshAccessToken()).toBe(false);
    expect(getToken()).toBeNull();
  });
});

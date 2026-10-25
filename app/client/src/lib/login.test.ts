import { afterEach, describe, expect, it, vi } from 'vitest';

import { login } from './login';
import { TOKEN_KEY } from './token';

const stubFetch = (response: Partial<Response> & { json?: () => Promise<unknown> }) => {
  const fetchMock = vi.fn().mockResolvedValue({ headers: new Headers(), ...response });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('login', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('posts form-encoded credentials with no Authorization header', async () => {
    localStorage.setItem(TOKEN_KEY, 'stale.gated.token');
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ accessToken: 'a.b.c' }),
    });

    await login('alice', 'pw');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/login');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(String(init.body)).toBe(
      new URLSearchParams({ username: 'alice', password: 'pw' }).toString()
    );
  });

  it('stores the token and reports ok on success', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({ accessToken: 'a.b.c' }) });
    await expect(login('alice', 'pw')).resolves.toEqual({ status: 'ok' });
    expect(localStorage.getItem(TOKEN_KEY)).toBe('a.b.c');
  });

  it('reports malformed, and stores nothing, when the body has no token', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({}) });
    await expect(login('alice', 'pw')).resolves.toEqual({ status: 'malformed' });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('reports rejected on any other non-2xx', async () => {
    stubFetch({ ok: false, status: 401 });
    await expect(login('alice', 'pw')).resolves.toEqual({ status: 'rejected' });
    stubFetch({ ok: false, status: 403 });
    await expect(login('alice', 'pw')).resolves.toEqual({ status: 'rejected' });
  });

  it('surfaces a usable Retry-After on 429, null otherwise', async () => {
    stubFetch({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '42' }) });
    await expect(login('alice', 'pw')).resolves.toEqual({
      status: 'rate-limited',
      retryAfterSeconds: 42,
    });
    stubFetch({ ok: false, status: 429, headers: new Headers({ 'Retry-After': 'soon' }) });
    await expect(login('alice', 'pw')).resolves.toEqual({
      status: 'rate-limited',
      retryAfterSeconds: null,
    });
  });

  it('reports network-error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(login('alice', 'pw')).resolves.toEqual({ status: 'network-error' });
  });
});

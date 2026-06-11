import { clearToken, decodeClaims, extractAccessToken, getToken, setToken } from './token';

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Calls POST /api/auth/refresh (the refresh token rides the httpOnly cookie).
 * Single-flight: concurrent callers share one request. On failure the stored
 * access token is cleared, which the AuthProvider observes as logged-out.
 */
export const refreshAccessToken = (): Promise<boolean> => {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch('/api/auth/refresh', { method: 'POST' });
      if (!response.ok) {
        clearToken();
        return false;
      }
      const accessToken = extractAccessToken(await response.json());
      if (!accessToken) {
        clearToken();
        return false;
      }
      setToken(accessToken);
      return true;
    } catch {
      clearToken();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
};

const withAuth = (init?: RequestInit): RequestInit => {
  const token = getToken();
  if (!token) return init ?? {};
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
};

/**
 * fetch with Authorization injection and a one-shot refresh-and-retry on 401.
 * The proactive timer in AuthProvider makes the retry path rare (laptop sleep,
 * clock drift); this is the safety net.
 */
export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await fetch(input, withAuth(init));
  if (response.status !== 401) return response;
  const refreshed = await refreshAccessToken();
  if (!refreshed) return response;
  return fetch(input, withAuth(init));
};

/**
 * Ensures the stored access token is good for at least the next minute,
 * refreshing through the cookie if not. For callers (XHR uploads) that
 * can't use apiFetch's 401 retry.
 */
export const ensureFreshToken = async (): Promise<string | null> => {
  const token = getToken();
  if (token) {
    const claims = decodeClaims(token);
    if (claims && claims.exp * 1000 - Date.now() > 60_000) return token;
  }
  await refreshAccessToken();
  return getToken();
};

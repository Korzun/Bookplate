import {
  clearToken,
  decodeClaims,
  extractAccessToken,
  getToken,
  isExpired,
  setToken,
} from './token';

const REFRESH_LOCK = 'hass-odps:auth-refresh';

let refreshInFlight: Promise<boolean> | null = null;

const isUsableToken = (token: string | null): token is string => {
  if (!token) return false;
  const claims = decodeClaims(token);
  return claims !== null && !isExpired(claims);
};

/**
 * Runs `fn` while holding a browser-wide lock so at most one tab refreshes at
 * a time. Falls back to running directly where the Web Locks API is missing
 * (older browsers, insecure contexts) — degrading to the old per-tab behaviour
 * rather than failing.
 */
const withRefreshLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (typeof navigator === 'undefined' || !navigator.locks) return fn();
  // navigator.locks.request resolves to the callback's settled value at
  // runtime; the async return lets TS flatten its imprecise Promise<Promise<T>>
  // typing back to Promise<T>.
  return navigator.locks.request(REFRESH_LOCK, fn);
};

/**
 * The actual network refresh. Assumes the caller holds the refresh lock, so it
 * is the only refresh in flight across every tab. An explicit rejection
 * (401/403) clears the stored access token; transient failures (network
 * errors, 5xx) leave it in place, since the proactive timer calls this while
 * the current token is still valid and a brief outage must not log the user
 * out.
 */
const performRefresh = async (): Promise<boolean> => {
  try {
    const response = await fetch('/api/auth/refresh', { method: 'POST' });
    if (response.status === 401 || response.status === 403) {
      clearToken();
      return false;
    }
    if (!response.ok) {
      return false;
    }
    const accessToken = extractAccessToken(await response.json());
    if (!accessToken) {
      return false;
    }
    setToken(accessToken);
    return true;
  } catch {
    return false;
  }
};

/**
 * Calls POST /api/auth/refresh (the refresh token rides the httpOnly cookie).
 *
 * Coordinated two ways so concurrent callers never double-spend the rotating
 * refresh token:
 *  - within a tab, single-flight: concurrent callers share one promise;
 *  - across tabs, a Web Lock serializes refreshes browser-wide. Whichever tab
 *    runs second finds the token a sibling just stored and adopts it, instead
 *    of presenting its now rotated-out refresh token — which would 401 and,
 *    before this coordination existed, clobber the fresh token and clear the
 *    cookie, logging every tab out.
 */
export const refreshAccessToken = (): Promise<boolean> => {
  refreshInFlight ??= (async () => {
    const tokenBefore = getToken();
    try {
      return await withRefreshLock(async () => {
        // A sibling tab may have refreshed while we waited for the lock. If a
        // different, still-valid token is now stored, adopt it rather than
        // spending our (already rotated-out) refresh token.
        const current = getToken();
        if (current !== tokenBefore && isUsableToken(current)) {
          return true;
        }
        return performRefresh();
      });
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

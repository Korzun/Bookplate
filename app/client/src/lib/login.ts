import { extractAccessToken, setToken } from './token';

export type LoginResult =
  /** Signed in; the access token is already stored (`setToken`). */
  | { status: 'ok' }
  /** `POST /api/login` answered 429. `retryAfterSeconds` is null when the header was absent or unusable. */
  | { status: 'rate-limited'; retryAfterSeconds: number | null }
  /** Any other non-2xx: wrong credentials, password not set, and so on. */
  | { status: 'rejected' }
  /** 2xx, but no usable `accessToken` in the body. */
  | { status: 'malformed' }
  /** `fetch` itself threw. */
  | { status: 'network-error' };

/**
 * The one `POST /api/login` call in the client (`lib/rest-seams.test.ts`
 * sanctions this file, not its callers). Pre-auth by construction: a bare
 * `fetch`, never `apiFetch`, so no stored token rides along — which matters
 * for the forced password-change page, whose stored token is a stale gated
 * one at the moment it calls this.
 *
 * On success the token is stored here rather than returned, mirroring
 * `performRefresh` in `api-fetch.ts`: `setToken` is what moves
 * `AuthProvider` and every route guard, so no caller should be able to
 * obtain a token and forget that step.
 *
 * `identifier` is what `/api/login` calls `username`: a username, or an email
 * address when it contains `@` (`routes/ui.ts` resolves it).
 */
export const login = async (identifier: string, password: string): Promise<LoginResult> => {
  let response: Response;
  try {
    response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: identifier, password }),
    });
  } catch {
    return { status: 'network-error' };
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After'));
    return {
      status: 'rate-limited',
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    };
  }
  if (!response.ok) return { status: 'rejected' };
  const accessToken = extractAccessToken(await response.json());
  if (accessToken === null) return { status: 'malformed' };
  setToken(accessToken);
  return { status: 'ok' };
};

export const TOKEN_KEY = 'accessToken';
export const TOKEN_CHANGED_EVENT = 'bookplate:token-changed';

export type AuthClaims = {
  userId?: string;
  username: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  exp: number;
};

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const setToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new Event(TOKEN_CHANGED_EVENT));
};

export const clearToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event(TOKEN_CHANGED_EVENT));
};

/**
 * Decodes the JWT payload without verifying the signature — the server is the
 * verifier; the client only reads display data from its own token.
 */
export const decodeClaims = (token: string): AuthClaims | null => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob(padded);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (typeof payload !== 'object' || payload === null) return null;
    const p = payload as Record<string, unknown>;
    // Full claim contract required; sub stays optional because the
    // config-based admin has no DB row and its tokens carry no sub.
    if (
      typeof p.username !== 'string' ||
      typeof p.exp !== 'number' ||
      typeof p.isAdmin !== 'boolean' ||
      typeof p.mustChangePassword !== 'boolean'
    ) {
      return null;
    }
    return {
      ...(typeof p.sub === 'string' ? { userId: p.sub } : {}),
      username: p.username,
      isAdmin: p.isAdmin,
      mustChangePassword: p.mustChangePassword,
      exp: p.exp,
    };
  } catch {
    return null;
  }
};

export const isExpired = (claims: AuthClaims): boolean => claims.exp * 1000 <= Date.now();

/**
 * Stable per-user identity for the current access token, or null when there is
 * no valid token (logged out). Prefers the DB user id; falls back to username
 * for the config-based admin, whose token carries no `sub`. Used to scope
 * device-local preferences so they follow the user, not the browser.
 */
export const currentIdentity = (): string | null => {
  const token = getToken();
  if (!token) return null;
  const claims = decodeClaims(token);
  return claims ? (claims.userId ?? claims.username) : null;
};

/**
 * Pulls the accessToken string out of an auth response body, or null when
 * the shape is wrong — guards against persisting "undefined" as a token.
 */
export const extractAccessToken = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) return null;
  const token = (body as Record<string, unknown>).accessToken;
  return typeof token === 'string' && token.length > 0 ? token : null;
};

const TOKEN_KEY = 'accessToken';
export const TOKEN_CHANGED_EVENT = 'hass-odps:token-changed';

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
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as unknown;
    if (typeof payload !== 'object' || payload === null) return null;
    const p = payload as Record<string, unknown>;
    if (typeof p.username !== 'string' || typeof p.exp !== 'number') return null;
    return {
      ...(typeof p.sub === 'string' ? { userId: p.sub } : {}),
      username: p.username,
      isAdmin: p.isAdmin === true,
      mustChangePassword: p.mustChangePassword === true,
      exp: p.exp,
    };
  } catch {
    return null;
  }
};

export const isExpired = (claims: AuthClaims): boolean => claims.exp * 1000 <= Date.now();

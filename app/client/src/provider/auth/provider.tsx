import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { refreshAccessToken } from '../../lib/api-fetch';
import { TOKEN_CHANGED_EVENT, TOKEN_KEY, decodeClaims, getToken, isExpired } from '../../lib/token';
import { Context, AuthContext } from './context';

const hasValidToken = (token: string | null): boolean => {
  if (!token) return false;
  const claims = decodeClaims(token);
  return claims !== null && !isExpired(claims);
};

export type AuthProviderProps = { children: ReactNode };
export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  // Loading is only meaningful for the mount-time silent refresh: if a valid
  // token is already present at mount there is nothing to wait for, so start
  // false. Otherwise stay true until the bootstrap refresh attempt resolves.
  // Derived from `token` (already assigned above) so we read localStorage once
  // and avoid an always-true + synchronous setLoading in the effect, keeping
  // the react-hooks rules satisfied without any suppression.
  const [loading, setLoading] = useState(!hasValidToken(token));

  // Keep state in sync with localStorage writes from lib/token (login, logout,
  // apiFetch refreshes). TOKEN_CHANGED_EVENT covers writes from this tab; the
  // native storage event covers writes from other tabs, so a tab that didn't
  // perform a refresh still adopts the freshly-stored token (and reacts to a
  // logout in a sibling tab) instead of running on until its own token expires.
  useEffect(() => {
    const onChange = () => setTokenState(getToken());
    const onStorage = (e: StorageEvent) => {
      // key === null fires on localStorage.clear(); TOKEN_KEY on set/remove.
      if (e.key === null || e.key === TOKEN_KEY) onChange();
    };
    window.addEventListener(TOKEN_CHANGED_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(TOKEN_CHANGED_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const claims = useMemo(() => (token ? decodeClaims(token) : null), [token]);
  const valid = claims !== null && !isExpired(claims);

  // First render only: with no valid token, silently try one refresh — the
  // httpOnly refresh cookie may still be good (keeps logins across browser
  // restarts). Runs once via the ref guard; deps stay complete so the
  // react-hooks rules are satisfied. setLoading only fires in the async
  // .finally, never synchronously in the effect body.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current || valid) return;
    bootstrapped.current = true;
    let cancelled = false;
    void refreshAccessToken().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      bootstrapped.current = false;
    };
  }, [valid]);

  // Proactive refresh one minute before expiry; each new token re-arms it.
  useEffect(() => {
    if (!valid || !claims) return;
    const delay = Math.max(claims.exp * 1000 - Date.now() - 60_000, 0);
    const timer = setTimeout(() => {
      if (isExpired(claims)) {
        // Woke past expiry (tab sleep): mask the expired window as loading so
        // route guards don't bounce to /login while the refresh is in flight.
        setLoading(true);
      }
      void refreshAccessToken().finally(() => setLoading(false));
    }, delay);
    return () => clearTimeout(timer);
  }, [claims, valid]);

  const state = useMemo<AuthContext>(
    () => ({
      username: valid ? claims.username : undefined,
      userId: valid ? claims.userId : undefined,
      isAdmin: valid ? claims.isAdmin : false,
      mustChangePassword: valid ? claims.mustChangePassword : false,
      loading,
    }),
    [claims, valid, loading]
  );

  return <Context.Provider value={state}>{children}</Context.Provider>;
};

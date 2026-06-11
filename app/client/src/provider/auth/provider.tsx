import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { refreshAccessToken } from '../../lib/api-fetch';
import { TOKEN_CHANGED_EVENT, decodeClaims, getToken, isExpired } from '../../lib/token';

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
  // Deriving the initial value here (instead of always-true + a synchronous
  // setLoading in the effect) keeps the react-hooks rules satisfied without
  // any suppression.
  const [loading, setLoading] = useState(() => !hasValidToken(getToken()));

  // Keep state in sync with localStorage writes from lib/token (login,
  // logout, apiFetch refreshes) — they all dispatch TOKEN_CHANGED_EVENT.
  useEffect(() => {
    const onChange = () => setTokenState(getToken());
    window.addEventListener(TOKEN_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(TOKEN_CHANGED_EVENT, onChange);
  }, []);

  const claims = useMemo(() => (token ? decodeClaims(token) : null), [token]);
  const valid = claims !== null && !isExpired(claims);

  // First render only: with no valid token, silently try one refresh — the
  // httpOnly refresh cookie may still be good (keeps logins across browser
  // restarts). Ref-guarded so the effect body runs once even though its deps
  // are complete (project rule: no eslint-disable; react-hooks rules stay on).
  // setLoading runs only in the async .finally callback, never synchronously
  // in the effect body, so it does not trip react-hooks/set-state-in-effect.
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
    };
  }, [valid]);

  // Proactive refresh one minute before expiry; each new token re-arms it.
  useEffect(() => {
    if (!valid || !claims) return;
    const delay = Math.max(claims.exp * 1000 - Date.now() - 60_000, 0);
    const timer = setTimeout(() => void refreshAccessToken(), delay);
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

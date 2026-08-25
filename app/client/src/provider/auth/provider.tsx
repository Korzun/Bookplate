import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { refreshAccessToken } from '../../lib/api-fetch';
import { consumeLoggedOutMark } from '../../lib/logout';
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
  // Latches once the logout marker is consumed and stays latched until a
  // session exists again. `consumeLoggedOutMark()` is destructive, so it alone
  // cannot answer "was this mount post-logout?" more than once — and under
  // <StrictMode> (main.tsx, development) React runs this effect
  // setup -> cleanup -> setup, so the second setup asks exactly that question
  // with the sessionStorage key already gone. Without the latch the second
  // setup falls through and refreshes, i.e. the whole suppression is absent in
  // dev. Cleared on any `valid === true` run below, which is what keeps this
  // from becoming a permanent disable: a genuine re-arm is always preceded by
  // a `valid` transition to true, a StrictMode double-invoke never is.
  const loggedOutSkip = useRef(false);
  useEffect(() => {
    if (valid) {
      // A session exists again (SPA login, adopted cross-tab token, successful
      // refresh). Whatever logout armed the latch is spent; the next loss of
      // this token must be free to refresh normally.
      loggedOutSkip.current = false;
      return;
    }
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    // A logout just happened. Its server-side cookie clear may have failed, in
    // which case the refresh cookie is still live and this refresh would
    // silently sign the user back in on the /login page they were just sent to.
    // One-shot: the next mount refreshes normally.
    if (loggedOutSkip.current || consumeLoggedOutMark()) {
      loggedOutSkip.current = true;
      setLoading(false);
      // No in-flight promise on this path, so no `cancelled` flag is needed —
      // but `bootstrapped.current` must still reset on cleanup like the
      // refresh path below, or this tab permanently loses its "re-arm silent
      // refresh on token loss" recovery the next time `valid` flips false
      // (e.g. an SPA login followed by a later cross-tab logout or expiry).
      return () => {
        bootstrapped.current = false;
      };
    }

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

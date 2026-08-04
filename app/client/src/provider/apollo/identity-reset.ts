import type { ApolloClient } from '@apollo/client';
import { useEffect, useRef } from 'react';

import { TOKEN_CHANGED_EVENT, TOKEN_KEY, currentIdentity } from '~/lib/token';

/**
 * Clears the Apollo store when the logged-in IDENTITY changes — not on every
 * token value change.
 *
 * Without this, the normalized cache survives a purely client-side identity
 * change (a revoked/expired refresh cookie bounces the route to /login with
 * no page reload, then a different user logs in over the same SPA heap) and
 * `cache-first` queries quietly serve the previous user's data. The
 * deliberate logout path is safe only by accident, via the hard navigation
 * in `provider/auth/hook/use-logout.ts`; a session ending any other way is
 * not.
 *
 * Keyed on `currentIdentity()`, NOT on the token value: a routine token
 * refresh mints a NEW token for the SAME identity every few minutes, and
 * clearing on every token write would empty the cache constantly and cause
 * refetch storms. Only a change in identity — including to/from null — may
 * clear.
 *
 * `clearStore()`, not `resetStore()`: `resetStore()` immediately refetches
 * every active query, which during a logged-out window would fire
 * authenticated queries with no token and produce a burst of 401s.
 * `clearStore()` just empties the store; components refetch naturally when
 * the new session mounts them.
 *
 * Listens to both `TOKEN_CHANGED_EVENT` (same-tab writes: login, logout,
 * refresh) and the native `storage` event (cross-tab), mirroring the pattern
 * `provider/auth/provider.tsx` already uses to stay in sync with
 * localStorage writes from any source.
 */
export const useResetApolloStoreOnIdentityChange = (
  client: Pick<ApolloClient, 'clearStore'>
): void => {
  const identityRef = useRef(currentIdentity());

  useEffect(() => {
    const checkIdentity = () => {
      const identity = currentIdentity();
      if (identity === identityRef.current) return;
      identityRef.current = identity;
      void client.clearStore();
    };
    const onStorage = (e: StorageEvent) => {
      // key === null fires on localStorage.clear(); TOKEN_KEY on set/remove.
      if (e.key === null || e.key === TOKEN_KEY) checkIdentity();
    };
    window.addEventListener(TOKEN_CHANGED_EVENT, checkIdentity);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(TOKEN_CHANGED_EVENT, checkIdentity);
      window.removeEventListener('storage', onStorage);
    };
  }, [client]);
};

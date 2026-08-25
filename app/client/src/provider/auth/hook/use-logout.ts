import { useCallback, useMemo, useState } from 'react';

import { logout as performLogout } from '../../../lib/logout';

/**
 * Narrowed from `[logout, loading, error, errorMessage]`: `logout()` is
 * best-effort and cannot fail in a way this hook could report, and its only
 * consumer (`page/user`) already destructured just the first two — the error
 * members never had a renderer, which is why a failed logout used to be
 * completely silent.
 */
export type UseLogout = [() => Promise<void>, boolean];

export const useLogout = (): UseLogout => {
  const [loading, setLoading] = useState(false);

  const logout = useCallback(async () => {
    setLoading(true);
    try {
      await performLogout();
    } finally {
      setLoading(false);
    }
  }, []);

  return useMemo(() => [logout, loading], [logout, loading]);
};

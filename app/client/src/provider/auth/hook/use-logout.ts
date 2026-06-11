import { useCallback, useMemo, useState } from 'react';

import { clearToken } from '../../../lib/token';

export type UseLogout = [() => Promise<void>, boolean, boolean, string | undefined];
export const useLogout = (): UseLogout => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const logout = useCallback(async () => {
    setLoading(true);
    setError(false);
    setErrorMessage(undefined);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      clearToken();
      window.location.href = '/login';
    } catch (err) {
      setError(true);
      if (err instanceof Error) {
        setErrorMessage(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return useMemo(
    () => [logout, loading, error, errorMessage],
    [logout, loading, error, errorMessage]
  );
};

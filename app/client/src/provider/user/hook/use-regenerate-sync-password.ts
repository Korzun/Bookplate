import { useCallback, useState } from 'react';

export const useRegenerateSyncPassword = (): [
  () => Promise<boolean>,
  boolean,
  string | null,
  boolean,
] => {
  const [loading, setLoading] = useState(false);
  const [syncPassword, setSyncPassword] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const regenerate = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(false);
    setSyncPassword(null);
    try {
      const res = await fetch('/api/my/sync-password/regenerate', { method: 'POST' });
      if (res.status !== 200) {
        setError(true);
        return false;
      }
      const data = (await res.json()) as { syncPassword: string };
      setSyncPassword(data.syncPassword);
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return [regenerate, loading, syncPassword, error];
};

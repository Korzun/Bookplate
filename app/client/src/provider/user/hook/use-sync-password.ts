import { useCallback, useEffect, useState } from 'react';

export const useSyncPassword = (): [string | null, boolean, boolean] => {
  const [syncPassword, setSyncPassword] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/my/sync-password');
      if (res.status !== 200) {
        setError(true);
        return;
      }
      const data = (await res.json()) as { syncPassword: string };
      setSyncPassword(data.syncPassword);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return [syncPassword, loading, error];
};

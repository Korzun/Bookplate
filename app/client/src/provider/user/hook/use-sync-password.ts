import { useEffect, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';

export const useSyncPassword = (): [string | null, boolean, boolean] => {
  const [syncPassword, setSyncPassword] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiFetch('/api/my/sync-password');
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
    };
    void load();
  }, []);

  return [syncPassword, loading, error];
};

import { useEffect, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';

export type UseDeviceUsers =
  | [string[], true, false, undefined]
  | [string[], false, false, undefined]
  | [string[], false, true, undefined]
  | [string[], false, true, string];

type FetchResult = { deviceId: string; users: string[] } | { deviceId: string; error: string };

export const useDeviceUsers = (deviceId?: string): UseDeviceUsers => {
  const [result, setResult] = useState<FetchResult | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    void apiFetch(`/api/devices/${encodeURIComponent(deviceId)}/users`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load device users (${response.status})`);
        const users = await (response.json() as Promise<string[]>);
        if (!cancelled) setResult({ deviceId, users });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setResult({ deviceId, error: err instanceof Error ? err.message : 'Unknown error' });
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  // Create mode: no device yet, nothing to fetch.
  if (!deviceId) return [[], false, false, undefined];
  if (result === null || result.deviceId !== deviceId) return [[], true, false, undefined];
  if ('error' in result) return [[], false, true, result.error];
  return [result.users, false, false, undefined];
};

import { useCallback, useMemo, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';

export type EnableDeviceUser = (deviceId: string, username: string) => Promise<boolean>;
export type UseEnableDeviceUser =
  | [EnableDeviceUser, false, false, undefined]
  | [EnableDeviceUser, true, false, undefined]
  | [EnableDeviceUser, false, true, undefined]
  | [EnableDeviceUser, false, true, string];

export const useEnableDeviceUser = (): UseEnableDeviceUser => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const enable = useCallback(async (deviceId: string, username: string): Promise<boolean> => {
    try {
      setLoading(true);
      setError(false);
      setErrorMessage(undefined);
      const response = await apiFetch(
        `/api/devices/${encodeURIComponent(deviceId)}/users/${encodeURIComponent(username)}`,
        { method: 'PUT' }
      );
      if (response.status !== 204) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to enable user');
      }
      return true;
    } catch (err) {
      setError(true);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to enable user');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return useMemo(
    () => [enable, loading, error, errorMessage] as UseEnableDeviceUser,
    [enable, loading, error, errorMessage]
  );
};

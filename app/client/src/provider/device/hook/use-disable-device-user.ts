import { useCallback, useMemo, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';

export type DisableDeviceUser = (deviceId: string, username: string) => Promise<boolean>;
export type UseDisableDeviceUser =
  | [DisableDeviceUser, false, false, undefined]
  | [DisableDeviceUser, true, false, undefined]
  | [DisableDeviceUser, false, true, undefined]
  | [DisableDeviceUser, false, true, string];

export const useDisableDeviceUser = (): UseDisableDeviceUser => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const disable = useCallback(async (deviceId: string, username: string): Promise<boolean> => {
    try {
      setLoading(true);
      setError(false);
      setErrorMessage(undefined);
      const response = await apiFetch(
        `/api/devices/${encodeURIComponent(deviceId)}/users/${encodeURIComponent(username)}`,
        { method: 'DELETE' }
      );
      if (response.status !== 204) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to disable user');
      }
      return true;
    } catch (err) {
      setError(true);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to disable user');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return useMemo(
    () => [disable, loading, error, errorMessage] as UseDisableDeviceUser,
    [disable, loading, error, errorMessage]
  );
};

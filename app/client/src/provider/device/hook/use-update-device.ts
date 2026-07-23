import { useCallback, use, useMemo, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import type { Device, DeviceInput } from '../type';

export type UpdateDevice = (id: string, input: DeviceInput) => Promise<Device | null>;
export type UseUpdateDevice =
  | [UpdateDevice, false, false, undefined] // Initial/ready
  | [UpdateDevice, true, false, undefined] // Updating
  | [UpdateDevice, false, true, undefined] // Unspecified error
  | [UpdateDevice, false, true, string]; // Specified error
export const useUpdateDevice = (): UseUpdateDevice => {
  const { setDeviceList } = use(Context);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const updateDevice = useCallback(
    async (id: string, input: DeviceInput): Promise<Device | null> => {
      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const response = await apiFetch(`/api/devices/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        if (response.status !== 200) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Failed to update device');
        }
        const device = (await response.json()) as Device;
        setDeviceList((prev) => ({ ...prev, [device.id]: device }));
        return device;
      } catch (err) {
        setError(true);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to update device');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [setDeviceList]
  );

  return useMemo(
    () => [updateDevice, loading, error, errorMessage] as UseUpdateDevice,
    [updateDevice, loading, error, errorMessage]
  );
};

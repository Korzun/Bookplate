import { useCallback, use, useMemo, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import type { Device, DeviceInput } from '../type';

export type CreateDevice = (input: DeviceInput) => Promise<Device | null>;
export type UseCreateDevice =
  | [CreateDevice, false, false, undefined] // Initial/ready
  | [CreateDevice, true, false, undefined] // Creating
  | [CreateDevice, false, true, undefined] // Unspecified error
  | [CreateDevice, false, true, string]; // Specified error
export const useCreateDevice = (): UseCreateDevice => {
  const { setDeviceList } = use(Context);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const createDevice = useCallback(
    async (input: DeviceInput): Promise<Device | null> => {
      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const response = await apiFetch('/api/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        if (response.status !== 201) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Failed to create device');
        }
        const device = (await response.json()) as Device;
        setDeviceList((prev) => ({ ...prev, [device.id]: device }));
        return device;
      } catch (err) {
        setError(true);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to create device');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [setDeviceList]
  );

  return useMemo(
    () => [createDevice, loading, error, errorMessage] as UseCreateDevice,
    [createDevice, loading, error, errorMessage]
  );
};

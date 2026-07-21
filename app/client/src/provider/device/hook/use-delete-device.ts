import { useCallback, useContext, useMemo, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import { removeDeviceById } from './util';

export type DeleteDevice = (id: string) => Promise<void>;
export type UseDeleteDevice =
  | [DeleteDevice, false, false, undefined] // Initial/ready
  | [DeleteDevice, true, false, undefined] // Delete in progress
  | [DeleteDevice, false, true, undefined] // Unspecified error
  | [DeleteDevice, false, true, string]; // Specified error
export const useDeleteDevice = (): UseDeleteDevice => {
  const { deviceList, setDeviceList } = useContext(Context);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const deleteDevice = useCallback(
    async (id: string) => {
      const device = deviceList[id];
      if (device === undefined) {
        setError(true);
        setErrorMessage('Failed to delete device');
        return;
      }

      setDeviceList((prev) => removeDeviceById(id, prev));

      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const response = await apiFetch(`/api/devices/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (response.status !== 204) {
          throw new Error('Failed to delete device');
        }
      } catch (err) {
        setError(true);
        setDeviceList((prev) => ({ ...prev, [id]: device }));
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setLoading(false);
      }
    },
    [deviceList, setDeviceList]
  );

  return useMemo(
    () => [deleteDevice, loading, error, errorMessage] as UseDeleteDevice,
    [deleteDevice, loading, error, errorMessage]
  );
};

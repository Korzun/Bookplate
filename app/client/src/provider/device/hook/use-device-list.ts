import { useCallback, use, useEffect, useMemo } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import type { Device } from '../type';

export const sortDeviceList = (deviceA: Device, deviceB: Device) =>
  deviceA.name.localeCompare(deviceB.name);

export type UseDeviceList =
  | [Device[], true, false, undefined]
  | [Device[], false, false, undefined]
  | [Device[], false, true, undefined]
  | [Device[], false, true, string];

export const useDeviceList = (): UseDeviceList => {
  const { deviceList, loading, error, setDeviceList, setLoading, setError } = use(Context);

  const getDeviceList = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await apiFetch('/api/devices');
      if (!response.ok) throw new Error(`Failed to load devices (${response.status})`);
      const devices = await (response.json() as Promise<Device[]>);
      setDeviceList(() =>
        devices.reduce(
          (record, device) => ({ ...record, [device.id]: device }),
          {} as Record<string, Device>
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [setDeviceList, setLoading, setError]);

  useEffect(() => {
    if (!loading && error === undefined && Object.keys(deviceList).length === 0) {
      void getDeviceList();
    }
    // loading, error, and deviceList are intentionally excluded: this effect is meant to fire once
    // on mount. getDeviceList is stable so deps never change. Adding the others would cause a
    // re-fetch loop when the server legitimately returns zero devices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDeviceList]);

  return useMemo(
    () =>
      [
        Object.values(deviceList).sort(sortDeviceList),
        loading,
        error !== undefined,
        error,
      ] as UseDeviceList,
    [deviceList, loading, error]
  );
};

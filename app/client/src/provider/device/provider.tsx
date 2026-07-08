import { useCallback, useState, type ReactNode } from 'react';

import { Context } from './context';
import { DeviceList } from './type';

export type DeviceProviderProps = { children: ReactNode };
export const DeviceProvider = ({ children }: DeviceProviderProps) => {
  const [deviceList, setDeviceListRaw] = useState<DeviceList>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const setDeviceList = useCallback(
    (updater: (prev: DeviceList) => DeviceList) => setDeviceListRaw(updater),
    []
  );

  return (
    <Context.Provider value={{ deviceList, loading, error, setDeviceList, setLoading, setError }}>
      {children}
    </Context.Provider>
  );
};

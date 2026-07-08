import { createContext } from 'react';

import { DeviceList } from './type';

export type DeviceContext = {
  deviceList: DeviceList;
  loading: boolean;
  error: string | undefined;
  setDeviceList: (updater: (prev: DeviceList) => DeviceList) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | undefined) => void;
};

export const Context = createContext<DeviceContext>({
  deviceList: {},
  loading: false,
  error: undefined,
  setDeviceList: () => {},
  setLoading: () => {},
  setError: () => {},
});

import { type ReactNode, useEffect, useState } from 'react';

import { Context } from './context';

export type ConfigProviderProps = { children: ReactNode };
export const ConfigProvider = ({ children }: ConfigProviderProps) => {
  const [libraryName, setLibraryName] = useState('HASS-ODPS');

  useEffect(() => {
    void fetch('/api/public-config')
      .then((r) => r.json() as Promise<{ libraryName: string }>)
      .then((cfg) => {
        if (cfg.libraryName) setLibraryName(cfg.libraryName);
      })
      .catch(() => {
        // keep default on failure
      });
  }, []);

  return <Context.Provider value={{ libraryName }}>{children}</Context.Provider>;
};

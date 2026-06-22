import { createContext } from 'react';

export interface ConfigContext {
  libraryName: string;
}

export const Context = createContext<ConfigContext>({
  libraryName: 'HASS-ODPS',
});

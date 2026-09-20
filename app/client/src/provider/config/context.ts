import { createContext } from 'react';

export interface ConfigContext {
  libraryName: string;
  emailEnabled: boolean;
}

export const Context = createContext<ConfigContext>({
  libraryName: 'Bookplate',
  emailEnabled: false,
});

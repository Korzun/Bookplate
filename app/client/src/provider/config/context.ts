import { createContext } from 'react';

export interface ConfigContext {
  libraryName: string;
  emailEnabled: boolean;
  /** Mail is configured AND the server has a `public_url` for the welcome link. */
  onboardingEnabled: boolean;
}

export const Context = createContext<ConfigContext>({
  libraryName: 'Bookplate',
  emailEnabled: false,
  onboardingEnabled: false,
});

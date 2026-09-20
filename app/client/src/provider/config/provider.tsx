import { type ReactNode, useEffect, useState } from 'react';

import { Context } from './context';

export type ConfigProviderProps = { children: ReactNode };
export const ConfigProvider = ({ children }: ConfigProviderProps) => {
  const [libraryName, setLibraryName] = useState('Bookplate');
  // Defaults to false so the forgot-password link and the email login hint are
  // hidden until the server says mail exists — the safe direction, since
  // offering a dead affordance is worse than briefly hiding a live one.
  const [emailEnabled, setEmailEnabled] = useState(false);

  useEffect(() => {
    void fetch('/api/public-config')
      .then((r) => r.json() as Promise<{ libraryName: string; emailEnabled?: boolean }>)
      .then((cfg) => {
        if (cfg.libraryName) setLibraryName(cfg.libraryName);
        setEmailEnabled(cfg.emailEnabled === true);
      })
      .catch(() => {
        // keep defaults on failure
      });
  }, []);

  return <Context.Provider value={{ libraryName, emailEnabled }}>{children}</Context.Provider>;
};

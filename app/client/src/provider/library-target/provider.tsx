import { type ReactNode, useCallback, useMemo, useState } from 'react';

import { Context } from './context';

const STORAGE_KEY = 'library-target-user';

export type LibraryTargetProviderProps = { children: ReactNode };
export const LibraryTargetProvider = ({ children }: LibraryTargetProviderProps) => {
  const [targetUsername, setTargetUsernameRaw] = useState<string | undefined>(
    () => localStorage.getItem(STORAGE_KEY) ?? undefined
  );

  const setTargetUsername = useCallback((username: string | undefined) => {
    if (username === undefined) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, username);
    }
    setTargetUsernameRaw(username);
  }, []);

  const state = useMemo(
    () => ({ targetUsername, setTargetUsername }),
    [targetUsername, setTargetUsername]
  );

  return <Context.Provider value={state}>{children}</Context.Provider>;
};

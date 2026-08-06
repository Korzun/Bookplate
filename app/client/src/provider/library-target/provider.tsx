import { type ReactNode, useCallback, useMemo, useState } from 'react';

import { Context } from './context';

const STORAGE_KEY = 'library-target-id';

export type LibraryTargetProviderProps = { children: ReactNode };
export const LibraryTargetProvider = ({ children }: LibraryTargetProviderProps) => {
  const [targetLibraryId, setTargetLibraryIdRaw] = useState<string | undefined>(
    () => localStorage.getItem(STORAGE_KEY) ?? undefined
  );

  const setTargetLibraryId = useCallback((libraryId: string | undefined) => {
    if (libraryId === undefined) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, libraryId);
    }
    setTargetLibraryIdRaw(libraryId);
  }, []);

  const state = useMemo(
    () => ({ targetLibraryId, setTargetLibraryId }),
    [targetLibraryId, setTargetLibraryId]
  );

  return <Context.Provider value={state}>{children}</Context.Provider>;
};

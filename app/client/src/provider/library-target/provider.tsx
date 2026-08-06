import { type ReactNode, useCallback, useMemo, useState } from 'react';

import { Context } from './context';

const STORAGE_KEY = 'library-target-id';

/**
 * The key Task 3 replaced with `STORAGE_KEY` (`library-target-id` now holds
 * a Library global ID, not a username). `useLibraryTarget`'s own test
 * already pins that a value under this old key is ignored, not migrated —
 * but nothing ever cleared it, so every admin who used a pre-Task-3 build
 * has carried a dead `library-target-user` entry in `localStorage` since.
 * Final-branch-review cleanup: removed once, here, on every mount — cheap,
 * idempotent (a no-op once the key is gone), and the one place this
 * provider already touches `localStorage` on init.
 */
const LEGACY_STORAGE_KEY = 'library-target-user';

export type LibraryTargetProviderProps = { children: ReactNode };
export const LibraryTargetProvider = ({ children }: LibraryTargetProviderProps) => {
  const [targetLibraryId, setTargetLibraryIdRaw] = useState<string | undefined>(() => {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  });

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

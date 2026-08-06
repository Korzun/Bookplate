import { createContext } from 'react';

export type LibraryTargetContext = {
  /** Library global ID an admin is operating on; undefined = none selected. */
  targetLibraryId: string | undefined;
  setTargetLibraryId: (libraryId: string | undefined) => void;
};

export const Context = createContext<LibraryTargetContext>({
  targetLibraryId: undefined,
  setTargetLibraryId: () => undefined,
});

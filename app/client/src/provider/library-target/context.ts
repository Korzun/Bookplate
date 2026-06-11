import { createContext } from 'react';

export type LibraryTargetContext = {
  /** Username of the library an admin is operating on; undefined = none selected. */
  targetUsername: string | undefined;
  setTargetUsername: (username: string | undefined) => void;
};

export const Context = createContext<LibraryTargetContext>({
  targetUsername: undefined,
  setTargetUsername: () => undefined,
});

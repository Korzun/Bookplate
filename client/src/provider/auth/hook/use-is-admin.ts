import { useContext, useMemo } from 'react';

import { Context } from '../context';

export type UseIsAdmin =
  | [boolean, false, false, undefined]
  | [boolean, true, false, undefined]
  | [false, false, true, undefined]
  | [false, false, true, string];
export const useIsAdmin = (): UseIsAdmin => {
  const { isAdmin, loading, error, errorMessage } = useContext(Context);

  return useMemo(
    () => [isAdmin, loading, error, errorMessage] as UseIsAdmin,
    [isAdmin, loading, error, errorMessage]
  );
};

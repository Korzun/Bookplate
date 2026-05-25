import { useContext, useMemo } from 'react';

import { Context } from '../context';

export type UseUsername =
  | [string, false, false, undefined]
  | [string | undefined, true, false, undefined]
  | [undefined, false, true, undefined]
  | [undefined, false, true, string];
export const useUsername = (): UseUsername => {
  const { username, loading, error, errorMessage } = useContext(Context);

  return useMemo(
    () => [username, loading, error, errorMessage] as UseUsername,
    [username, loading, error, errorMessage]
  );
};

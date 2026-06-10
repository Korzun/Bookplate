import { useContext, useMemo } from 'react';

import { Context } from '../context';

export type UseMustChangePassword =
  | [boolean, false, false, undefined]
  | [boolean, true, false, undefined]
  | [false, false, true, undefined]
  | [false, false, true, string];
export const useMustChangePassword = (): UseMustChangePassword => {
  const { mustChangePassword, loading, error, errorMessage } = useContext(Context);

  return useMemo(
    () => [mustChangePassword, loading, error, errorMessage] as UseMustChangePassword,
    [mustChangePassword, loading, error, errorMessage]
  );
};

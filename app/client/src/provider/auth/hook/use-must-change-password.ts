import { useContext, useMemo } from 'react';

import { Context } from '../context';

export type UseMustChangePassword = [boolean, boolean];
export const useMustChangePassword = (): UseMustChangePassword => {
  const { mustChangePassword, loading } = useContext(Context);
  return useMemo(() => [mustChangePassword, loading], [mustChangePassword, loading]);
};

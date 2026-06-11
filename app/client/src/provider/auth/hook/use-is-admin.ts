import { useContext, useMemo } from 'react';

import { Context } from '../context';

export type UseIsAdmin = [boolean, boolean];
export const useIsAdmin = (): UseIsAdmin => {
  const { isAdmin, loading } = useContext(Context);
  return useMemo(() => [isAdmin, loading], [isAdmin, loading]);
};

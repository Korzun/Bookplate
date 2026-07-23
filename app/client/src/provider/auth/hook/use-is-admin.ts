import { use, useMemo } from 'react';

import { Context } from '../context';

export type UseIsAdmin = [boolean, boolean];
export const useIsAdmin = (): UseIsAdmin => {
  const { isAdmin, loading } = use(Context);
  return useMemo(() => [isAdmin, loading], [isAdmin, loading]);
};

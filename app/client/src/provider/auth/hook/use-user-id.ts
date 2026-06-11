import { useContext, useMemo } from 'react';

import { Context } from '../context';

export type UseUserId = [string | undefined, boolean];
export const useUserId = (): UseUserId => {
  const { userId, loading } = useContext(Context);
  return useMemo(() => [userId, loading], [userId, loading]);
};

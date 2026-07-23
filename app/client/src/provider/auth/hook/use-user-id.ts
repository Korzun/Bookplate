import { use, useMemo } from 'react';

import { Context } from '../context';

export type UseUserId = [string | undefined, boolean];
export const useUserId = (): UseUserId => {
  const { userId, loading } = use(Context);
  return useMemo(() => [userId, loading], [userId, loading]);
};

import { use, useMemo } from 'react';

import { Context } from '../context';

export type UseUsername = [string | undefined, boolean];
export const useUsername = (): UseUsername => {
  const { username, loading } = use(Context);
  return useMemo(() => [username, loading], [username, loading]);
};

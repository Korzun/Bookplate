import { useContext, useMemo } from 'react';

import { Context } from '../context';

export type UseUsername = [string | undefined, boolean];
export const useUsername = (): UseUsername => {
  const { username, loading } = useContext(Context);
  return useMemo(() => [username, loading], [username, loading]);
};

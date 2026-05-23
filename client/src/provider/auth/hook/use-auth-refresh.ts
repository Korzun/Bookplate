import { useContext } from 'react';

import { Context } from '../context';

export const useAuthRefresh = (): (() => Promise<void>) => {
  const { refetch } = useContext(Context);
  return refetch;
};

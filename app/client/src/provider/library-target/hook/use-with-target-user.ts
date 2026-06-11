import { useCallback, useContext } from 'react';

import { useIsAdmin } from '~/provider/auth';

import { Context } from '../context';

export type WithTargetUser = (url: string) => string;

/**
 * Returns a function that appends ?user=<target> to book API URLs when an
 * admin has a library selected. For regular users it returns URLs unchanged —
 * the server scopes requests to their own library.
 */
export const useWithTargetUser = (): WithTargetUser => {
  const [isAdmin] = useIsAdmin();
  const { targetUsername } = useContext(Context);

  return useCallback(
    (url: string) => {
      if (!isAdmin || !targetUsername) return url;
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}user=${encodeURIComponent(targetUsername)}`;
    },
    [isAdmin, targetUsername]
  );
};

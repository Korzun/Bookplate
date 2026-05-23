import { useCallback, useContext } from 'react';

import { useIsAdmin } from '../../auth';
import { Context } from '../context';
import type { Progress, UserProgressList } from '../type';

export type FetchUserProgressList = (username: string) => Promise<void>;

export const useFetchUserProgressList = (): FetchUserProgressList => {
  const { loadingByUsername, setLoadingForUsername, setErrorForUsername, setProgressForUsername } =
    useContext(Context);
  const [isAdmin] = useIsAdmin();

  return useCallback(
    async (username: string) => {
      if (isAdmin !== true || loadingByUsername[username]) return;

      setLoadingForUsername(username, true);
      setErrorForUsername(username, undefined);
      try {
        const response = await fetch(`/api/users/${encodeURIComponent(username)}/progress`);
        if (!response.ok) throw new Error('Failed to fetch progress');
        const data = await (response.json() as Promise<Progress[]>);
        setProgressForUsername(
          username,
          data.reduce((acc, p) => ({ ...acc, [p.document]: p }), {} as UserProgressList)
        );
      } catch (err) {
        setErrorForUsername(username, err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoadingForUsername(username, false);
      }
    },
    [loadingByUsername, setLoadingForUsername, setErrorForUsername, setProgressForUsername, isAdmin]
  );
};

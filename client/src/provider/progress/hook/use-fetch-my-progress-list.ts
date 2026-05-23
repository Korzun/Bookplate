import { useCallback, useContext } from 'react';

import { useIsAdmin, useUsername } from '../../../provider/auth';
import { Context } from '../context';
import type { Progress, UserProgressList } from '../type';

export type FetchMyProgressList = () => Promise<void>;

export const useFetchMyProgressList = (): FetchMyProgressList => {
  const { loadingByUsername, setLoadingForUsername, setErrorForUsername, setProgressForUsername } =
    useContext(Context);
  const [username] = useUsername();
  const [isAdmin] = useIsAdmin();

  return useCallback(async () => {
    if (isAdmin === true || username === undefined) return;
    if (loadingByUsername[username]) return;

    setLoadingForUsername(username, true);
    setErrorForUsername(username, undefined);
    try {
      const response = await fetch('/api/my/progress');
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
  }, [
    isAdmin,
    username,
    loadingByUsername,
    setLoadingForUsername,
    setErrorForUsername,
    setProgressForUsername,
  ]);
};

import { use, useEffect, useMemo } from 'react';

import { useUsername } from '../../../provider/auth';
import { Context } from '../context';
import type { UserProgressList } from '../type';
import { useFetchMyProgressList } from './use-fetch-my-progress-list';

export type UseMyProgressList =
  | [undefined, false, false, undefined]
  | [UserProgressList, false, false, undefined]
  | [UserProgressList, true, false, undefined]
  | [undefined, true, false, undefined]
  | [undefined, false, true, undefined]
  | [undefined, false, true, string];

export const useMyProgressList = (): UseMyProgressList => {
  const { progressList, loadingByUsername, errorByUsername } = use(Context);
  const [username] = useUsername();
  const fetchMyProgressList = useFetchMyProgressList();

  const loading = username !== undefined ? (loadingByUsername[username] ?? false) : false;
  const errorMessage = username !== undefined ? errorByUsername[username] : undefined;

  useEffect(() => {
    if (username === undefined) return;
    if (progressList[username] !== undefined) return;
    if (loadingByUsername[username]) return;
    if (errorByUsername[username] !== undefined) return;
    void fetchMyProgressList();
  }, [username, progressList, loadingByUsername, errorByUsername, fetchMyProgressList]);

  return useMemo((): UseMyProgressList => {
    if (username === undefined) return [undefined, false, true, 'User not logged in'];
    if (errorMessage !== undefined) return [undefined, false, true, errorMessage];
    return [progressList[username], loading, false, undefined];
  }, [progressList, loading, errorMessage, username]);
};

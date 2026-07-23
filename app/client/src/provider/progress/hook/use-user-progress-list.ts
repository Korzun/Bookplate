import { use, useEffect, useMemo } from 'react';

import { Context } from '../context';
import type { UserProgressList } from '../type';
import { useFetchUserProgressList } from './use-fetch-user-progress-list';

export type UseUserProgressList =
  | [undefined, false, false, undefined]
  | [UserProgressList, false, false, undefined]
  | [UserProgressList, true, false, undefined]
  | [undefined, true, false, undefined]
  | [undefined, false, true, undefined]
  | [undefined, false, true, string];

export const useUserProgressList = (username: string | undefined): UseUserProgressList => {
  const { progressList, loadingByUsername, errorByUsername } = use(Context);
  const fetchUserProgressList = useFetchUserProgressList();

  const loading = username !== undefined ? (loadingByUsername[username] ?? false) : false;
  const errorMessage = username !== undefined ? errorByUsername[username] : undefined;

  useEffect(() => {
    if (username === undefined) return;
    if (progressList[username] !== undefined) return;
    if (loadingByUsername[username]) return;
    if (errorByUsername[username] !== undefined) return;
    void fetchUserProgressList(username);
  }, [username, progressList, loadingByUsername, errorByUsername, fetchUserProgressList]);

  return useMemo((): UseUserProgressList => {
    if (username === undefined) return [undefined, false, false, undefined];
    if (errorMessage !== undefined) return [undefined, false, true, errorMessage];
    return [progressList[username], loading, false, undefined];
  }, [progressList, loading, errorMessage, username]);
};

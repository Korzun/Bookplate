import { useContext, useMemo } from 'react';

import { Context } from '../context';
import type { Progress } from '../type';

import { useUserProgressList } from './use-user-progress-list';

export type UseUserProgress =
  | [undefined, false, false, undefined] // Initial State (or if no progress exists for user)
  | [Progress, false, false, undefined] // Progress was successfully loaded
  | [Progress, true, false, undefined] // Progress was already successfully loaded and new progress is being loaded
  | [undefined, true, false, undefined] // Progress is being loaded
  | [undefined, false, true, undefined] // There was an unspecified error while loading progress
  | [undefined, false, true, string]; // There was a specified error while loading progress
export const useUserProgress = (username: string, bookId: string): UseUserProgress => {
  const { progressList } = useContext(Context);
  const [myProgressList, loading, error, errorMessage] = useUserProgressList(username);

  return useMemo((): UseUserProgress => {
    if (error) {
      return [undefined, false, error, errorMessage];
    }

    if (myProgressList === undefined || myProgressList[bookId] === undefined) {
      return [undefined, loading, false, undefined];
    }
    return [myProgressList[bookId], loading, false, undefined];
  }, [progressList, loading, error, errorMessage]);
};

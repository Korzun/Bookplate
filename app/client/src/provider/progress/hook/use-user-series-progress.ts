import { useMemo } from 'react';

import { useSeriesBookList, type Book } from '../../book';
import type { UserProgressList } from '../type';

import { useUserProgressList } from './use-user-progress-list';

export type UseUserSeriesProgress =
  | [undefined, false, false, undefined] // Initial State (or if no progress exists for user)
  | [number, false, false, undefined] // Progress was successfully loaded
  | [number, true, false, undefined] // Progress was already successfully loaded and new progress is being loaded
  | [undefined, true, false, undefined] // Progress is being loaded
  | [undefined, false, true, undefined] // There was an unspecified error while loading progress
  | [undefined, false, true, string]; // There was a specified error while loading progress
export const useUserSeriesProgress = (
  username: string | undefined,
  seriesName: string
): UseUserSeriesProgress => {
  const [userProgressList, loading, error, errorMessage] = useUserProgressList(username);
  const [seriesBookList] = useSeriesBookList(seriesName);

  return useMemo((): UseUserSeriesProgress => {
    if (loading) {
      return [undefined, true, false, undefined];
    }
    if (error) {
      return [undefined, false, error, errorMessage];
    }
    if (userProgressList === undefined || seriesBookList === undefined) {
      return [undefined, false, false, undefined];
    }
    const seriesProgress = calculateSeriesProgressPercent(seriesBookList, userProgressList);
    return [seriesProgress, false, false, undefined];
  }, [loading, error, errorMessage, userProgressList, seriesBookList]);
};

const calculateSeriesProgressPercent = (
  books: Book[],
  progressMap: UserProgressList
): number | undefined => {
  if (!books.some((book) => progressMap[book.id])) {
    return undefined;
  }
  const avg =
    books.reduce((sum, book) => {
      return sum + (progressMap[book.id]?.percentage ?? 0);
    }, 0) / books.length;

  return avg;
};

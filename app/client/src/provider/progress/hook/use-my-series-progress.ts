import { useMemo } from 'react';

import { useSeriesBookList } from '../../book';
import { calculateSeriesProgressPercent } from '../helper';
import { useMyProgressList } from './use-my-progress-list';

export type UseMySeriesProgress =
  | [undefined, false, false, undefined] // Initial State (or if no progress exists for user)
  | [number, false, false, undefined] // Progress was successfully loaded
  | [number, true, false, undefined] // Progress was already successfully loaded and new progress is being loaded
  | [undefined, true, false, undefined] // Progress is being loaded
  | [undefined, false, true, undefined] // There was an unspecified error while loading progress
  | [undefined, false, true, string]; // There was a specified error while loading progress
export const useMySeriesProgress = (seriesName: string): UseMySeriesProgress => {
  const [myProgressList, loading, error, errorMessage] = useMyProgressList();
  const [seriesBookList] = useSeriesBookList(seriesName);

  return useMemo((): UseMySeriesProgress => {
    if (loading) {
      return [undefined, true, false, undefined];
    }
    if (error) {
      return [undefined, false, error, errorMessage];
    }
    if (myProgressList === undefined || seriesBookList === undefined) {
      return [undefined, false, false, undefined];
    }
    const seriesProgress = calculateSeriesProgressPercent(seriesBookList, myProgressList);
    return [seriesProgress, false, false, undefined];
  }, [loading, error, errorMessage, myProgressList, seriesBookList]);
};

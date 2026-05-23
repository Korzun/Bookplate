import { useMemo } from 'react';

import { useUsername } from '../../../provider/auth';

import { useUserSeriesProgress } from './use-user-series-progress';

export type UseMySeriesProgress =
  | [undefined, false, false, undefined] // Initial State (or if no progress exists for user)
  | [number, false, false, undefined] // Progress was successfully loaded
  | [number, true, false, undefined] // Progress was already successfully loaded and new progress is being loaded
  | [undefined, true, false, undefined] // Progress is being loaded
  | [undefined, false, true, undefined] // There was an unspecified error while loading progress
  | [undefined, false, true, string]; // There was a specified error while loading progress
export const useMySeriesProgress = (seriesName: string): UseMySeriesProgress => {
  const [username, usernameLoading, usernameError, usernameErrorMessage] = useUsername();
  const [seriesProgress, progressLoading, progressError, progressErrorMessage] =
    useUserSeriesProgress(username, seriesName);

  return useMemo((): UseMySeriesProgress => {
    if (usernameError) {
      return [undefined, false, true, usernameErrorMessage];
    }
    if (progressError) {
      return [undefined, false, true, progressErrorMessage];
    }
    if (usernameLoading || progressLoading) {
      return [seriesProgress as number | undefined, true, false, undefined];
    }
    return [seriesProgress, false, false, undefined];
  }, [
    seriesProgress,
    progressLoading,
    progressError,
    progressErrorMessage,
    usernameLoading,
    usernameError,
    usernameErrorMessage,
  ]);
};

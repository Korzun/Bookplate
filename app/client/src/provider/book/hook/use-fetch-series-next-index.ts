import { useCallback } from 'react';

import { apiFetch } from '~/lib/api-fetch';
import { useWithTargetUser } from '~/provider/library-target';

export type FetchSeriesNextIndex = (name: string) => Promise<number>;

export const useFetchSeriesNextIndex = (): FetchSeriesNextIndex => {
  const withTargetUser = useWithTargetUser();

  return useCallback(
    async (name: string): Promise<number> => {
      const res = await apiFetch(
        withTargetUser(`/api/series/${encodeURIComponent(name)}/next-index`)
      );
      if (!res.ok) throw new Error('Failed to fetch next series index');
      const { nextIndex } = await (res.json() as Promise<{ nextIndex: number }>);
      return nextIndex;
    },
    [withTargetUser]
  );
};

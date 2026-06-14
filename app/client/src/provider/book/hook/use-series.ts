import { useEffect, useState } from 'react';

import { apiFetch } from '~/lib/api-fetch';
import { useWithTargetUser } from '~/provider/library-target';

export type SeriesMeta = {
  name: string;
  subjects: string[];
  bookCount: number;
  author: string;
  publisher: string;
  totalPages: number;
};

export type UseSeries =
  | [SeriesMeta, false, false, undefined]
  | [undefined, true, false, undefined]
  | [undefined, false, true, undefined]
  | [undefined, false, true, string];

export const useSeries = (seriesName: string): UseSeries => {
  const [data, setData] = useState<SeriesMeta | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const withTargetUser = useWithTargetUser();

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    setData(undefined);
    void apiFetch(withTargetUser(`/api/series/${encodeURIComponent(seriesName)}`))
      .then(async (res) => {
        if (!res.ok) throw new Error('Series not found');
        const meta = await (res.json() as Promise<SeriesMeta>);
        if (!cancelled) setData(meta);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      });
    return () => {
      cancelled = true;
    };
  }, [seriesName, withTargetUser]);

  if (error !== undefined) return [undefined, false, true, error];
  if (data !== undefined) return [data, false, false, undefined];
  return [undefined, true, false, undefined];
};

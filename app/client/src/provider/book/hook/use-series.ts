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

type FetchResult = { seriesName: string; meta: SeriesMeta } | { seriesName: string; error: string };

export const useSeries = (seriesName: string): UseSeries => {
  const [result, setResult] = useState<FetchResult | null>(null);
  const withTargetUser = useWithTargetUser();

  useEffect(() => {
    let cancelled = false;
    void apiFetch(withTargetUser(`/api/series/${encodeURIComponent(seriesName)}`))
      .then(async (res) => {
        if (!res.ok) throw new Error('Series not found');
        const meta = await (res.json() as Promise<SeriesMeta>);
        if (!cancelled) setResult({ seriesName, meta });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setResult({ seriesName, error: err instanceof Error ? err.message : 'Unknown error' });
      });
    return () => {
      cancelled = true;
    };
  }, [seriesName, withTargetUser]);

  if (result === null || result.seriesName !== seriesName) return [undefined, true, false, undefined];
  if ('error' in result) return [undefined, false, true, result.error];
  return [result.meta, false, false, undefined];
};

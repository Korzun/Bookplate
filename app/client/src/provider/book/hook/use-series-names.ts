import { useEffect, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';

type Result = { url: string; series: string[] } | { url: string; error: string };

/**
 * Fetches the library's series names already ordered by the server-computed sort
 * key (leading articles such as "the", "a", "an" are stripped server-side). Used
 * to populate the series autocomplete in the book edit form.
 */
export const useSeriesNames = (): [string[], boolean, string | undefined] => {
  const [result, setResult] = useState<Result | null>(null);
  const withTargetUser = useWithTargetUser();
  const url = withTargetUser('/api/series');

  useEffect(() => {
    let cancelled = false;

    apiFetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch series');
        return res.json() as Promise<{ series: string[] }>;
      })
      .then((data) => {
        if (!cancelled) setResult({ url, series: data.series });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setResult({ url, error: err instanceof Error ? err.message : 'Unknown error' });
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (result === null || result.url !== url) return [[], true, undefined];
  if ('error' in result) return [[], false, result.error];
  return [result.series, false, undefined];
};

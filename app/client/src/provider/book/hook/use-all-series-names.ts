import { useEffect, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { useWithTargetUser } from '../../library-target';

type Result = { baseUrl: string; items: string[] } | { baseUrl: string; error: string };

export const useAllSeriesNames = (): [string[], boolean, string | undefined] => {
  const [result, setResult] = useState<Result | null>(null);
  const withTargetUser = useWithTargetUser();
  const baseUrl = withTargetUser('/api/series-names');

  useEffect(() => {
    let cancelled = false;
    const accumulated: string[] = [];

    const fetchPage = async (cursor?: string): Promise<void> => {
      const sep = baseUrl.includes('?') ? '&' : '?';
      const url = `${baseUrl}${sep}take=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await apiFetch(url);
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as { items: string[]; nextCursor: string | null };
      if (cancelled) return;
      accumulated.push(...data.items);
      setResult({ baseUrl, items: [...accumulated] });
      if (data.nextCursor) await fetchPage(data.nextCursor);
    };

    fetchPage().catch((err: unknown) => {
      if (!cancelled)
        setResult({ baseUrl, error: err instanceof Error ? err.message : 'Unknown error' });
    });

    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  if (result === null || result.baseUrl !== baseUrl) return [[], true, undefined];
  if ('error' in result) return [[], false, result.error];
  return [result.items, false, undefined];
};

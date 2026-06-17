import { useEffect, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { useWithTargetUser } from '../../library-target';

export type BookTitleEntry = { id: string; title: string };

type Result = { baseUrl: string; items: BookTitleEntry[] } | { baseUrl: string; error: string };

export const useAllBookTitles = (): [BookTitleEntry[], boolean, string | undefined] => {
  const [result, setResult] = useState<Result | null>(null);
  const withTargetUser = useWithTargetUser();
  const baseUrl = withTargetUser('/api/books/titles');

  useEffect(() => {
    let cancelled = false;
    const accumulated: BookTitleEntry[] = [];

    const fetchPage = async (cursor?: string): Promise<void> => {
      const sep = baseUrl.includes('?') ? '&' : '?';
      const url = `${baseUrl}${sep}take=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await apiFetch(url);
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as { items: BookTitleEntry[]; nextCursor: string | null };
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

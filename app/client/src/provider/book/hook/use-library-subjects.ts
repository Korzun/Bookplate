import { useEffect, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';

type SubjectFilters = { author?: string; seriesName?: string };
type Result = { url: string; subjects: string[] } | { url: string; error: string };

export const useLibrarySubjects = (
  filters?: SubjectFilters
): [string[], boolean, string | undefined] => {
  const [result, setResult] = useState<Result | null>(null);
  const withTargetUser = useWithTargetUser();
  const params = new URLSearchParams();
  if (filters?.author) params.set('author', filters.author);
  if (filters?.seriesName) params.set('seriesName', filters.seriesName);
  const paramStr = params.toString();
  const url = withTargetUser(`/api/subjects${paramStr ? `?${paramStr}` : ''}`);

  useEffect(() => {
    let cancelled = false;

    apiFetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch subjects');
        return res.json() as Promise<{ subjects: string[] }>;
      })
      .then((data) => {
        if (!cancelled) setResult({ url, subjects: data.subjects });
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
  return [result.subjects, false, undefined];
};

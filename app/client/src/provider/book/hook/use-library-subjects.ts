import { useEffect, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';

type Result = { url: string; subjects: string[] } | { url: string; error: string };

export const useLibrarySubjects = (): [string[], boolean, string | undefined] => {
  const [result, setResult] = useState<Result | null>(null);
  const withTargetUser = useWithTargetUser();
  const url = withTargetUser('/api/subjects');

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

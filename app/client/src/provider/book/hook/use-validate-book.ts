import { useCallback, useMemo, useState } from 'react';

import type { ValidationReport } from '~/lib/severity';
import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';

export type UseValidateBook = [(id: string) => Promise<ValidationReport | undefined>, boolean];

export const useValidateBook = (): UseValidateBook => {
  const withTargetUser = useWithTargetUser();
  const [loading, setLoading] = useState(false);

  const validateBook = useCallback(
    async (id: string): Promise<ValidationReport | undefined> => {
      if (loading) return undefined;
      try {
        setLoading(true);
        const res = await apiFetch(
          withTargetUser(`/api/books/${encodeURIComponent(id)}/validate`),
          {
            method: 'POST',
          }
        );
        if (!res.ok) return undefined;
        return (await res.json()) as ValidationReport;
      } catch {
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [withTargetUser, loading]
  );

  return useMemo<UseValidateBook>(() => [validateBook, loading], [validateBook, loading]);
};

import { useCallback, useContext, useMemo, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';

export type UseClearBookEditions = [
  (id: string) => Promise<number | undefined>,
  boolean,
  boolean,
  string | undefined,
];

export const useClearBookEditions = (): UseClearBookEditions => {
  const { setBookList } = useContext(Context);
  const withTargetUser = useWithTargetUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const clearBookEditions = useCallback(
    async (id: string): Promise<number | undefined> => {
      if (loading) return;

      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);
        const res = await apiFetch(
          withTargetUser(`/api/books/${encodeURIComponent(id)}/editions`),
          {
            method: 'DELETE',
          }
        );
        if (!res.ok) throw new Error('Failed to clear device editions');
        const body = (await res.json()) as { cleared: number };
        setBookList((prev) => {
          const book = prev[id];
          if (book === undefined) return prev;
          return { ...prev, [id]: { ...book, deviceEditionCount: 0 } };
        });
        return body.cleared;
      } catch (err) {
        setError(true);
        if (err instanceof Error) setErrorMessage(err.message);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [withTargetUser, loading, setBookList]
  );

  return useMemo(
    () => [clearBookEditions, loading, error, errorMessage],
    [clearBookEditions, loading, error, errorMessage]
  );
};

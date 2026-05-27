import { useCallback, useContext, useMemo, useState } from 'react';

import { Context } from '../context';
import type { Book } from '../type';

export type UseRegenChapters = [
  (id: string) => Promise<void>,
  boolean,
  boolean,
  string | undefined,
];

export const useRegenChapters = (): UseRegenChapters => {
  const { setBookList } = useContext(Context);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const regenChapters = useCallback(
    async (id: string) => {
      if (loading) return;

      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);
        const res = await fetch(`/api/books/${encodeURIComponent(id)}/regen-chapters`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error('Failed to regenerate chapters');
        const updated = await (res.json() as Promise<Book>);
        setBookList((prev) => ({ ...prev, [updated.id]: updated }));
      } catch (err) {
        setError(true);
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setLoading(false);
      }
    },
    [loading, setBookList]
  );

  return useMemo(
    () => [regenChapters, loading, error, errorMessage],
    [regenChapters, loading, error, errorMessage]
  );
};

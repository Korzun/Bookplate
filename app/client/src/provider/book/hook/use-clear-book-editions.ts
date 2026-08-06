import { useCallback, use, useMemo, useState } from 'react';

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
  const { setBookList } = use(Context);
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
        // Updates every `bookList` entry describing this book (`.id === id`),
        // not just `prev[id]` itself — same alias sweep as
        // `use-regen-chapters.ts`/`use-patch-book-metadata.ts`/`use-delete-book.ts`
        // (see any of their doc comments for the full mechanism). A book
        // reached both via its Relay global id (the grid) and its raw id
        // (the search dropdown) sits under TWO `bookList` keys; writing only
        // `prev[id]` left the OTHER alias's `deviceEditionCount` stale —
        // still showing the pre-clear count until an unrelated refetch
        // happened to overwrite it.
        setBookList((prev) => {
          const book = prev[id];
          if (book === undefined) return prev;
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (next[key]?.id === book.id) next[key] = { ...next[key], deviceEditionCount: 0 };
          }
          return next;
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

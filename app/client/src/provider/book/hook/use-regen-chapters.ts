import { useCallback, use, useMemo, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context as ProgressContext } from '../../progress/context';
import { Context } from '../context';
import type { Book } from '../type';

export type UseRegenChapters = [
  (id: string) => Promise<void>,
  boolean,
  boolean,
  string | undefined,
];

export const useRegenChapters = (): UseRegenChapters => {
  const { setBookList } = use(Context);
  const { renameProgressKey } = use(ProgressContext);
  const withTargetUser = useWithTargetUser();
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
        const res = await apiFetch(
          withTargetUser(`/api/books/${encodeURIComponent(id)}/regen-chapters`),
          {
            method: 'POST',
          }
        );
        if (!res.ok) throw new Error('Failed to regenerate chapters');
        const updated = await (res.json() as Promise<Book>);
        // Delete every `bookList` entry describing the PRE-regen book (`.id
        // === id`), not just `next[id]` itself: since `useFetchBook` (task
        // 8) now keys entries by the id they were REQUESTED under rather
        // than the book's own raw id, a book reached via a Relay global id
        // (the grid) can be cached under a key that ISN'T `id` — `id` here
        // is always `book.id` (raw; `page/book` calls `regenChapters(book.id)`)
        // — while a stale copy of the SAME book sits under its global-id
        // key. `next[id]` alone would leave that alias untouched, holding
        // pre-regen data forever (`completeBookIds` already marks it
        // complete, so `useBook` never refetches — chapters wouldn't
        // reflect the regen until a hard reload). Deleting by value match
        // instead removes every stale copy; if that happens to be the
        // book's own global-id key, `useBook`'s `bookList[bookId] ===
        // undefined` guard fires exactly once more and self-heals through
        // the now-correctly-keyed `useFetchBook`, rather than looping.
        setBookList((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (next[key]?.id === id) delete next[key];
          }
          next[updated.id] = updated;
          return next;
        });
        if (updated.id !== id) renameProgressKey(id, updated.id);
      } catch (err) {
        setError(true);
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setLoading(false);
      }
    },
    [withTargetUser, loading, setBookList, renameProgressKey]
  );

  return useMemo(
    () => [regenChapters, loading, error, errorMessage],
    [regenChapters, loading, error, errorMessage]
  );
};

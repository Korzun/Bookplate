import { useCallback, useContext } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { useIsAdmin } from '../../auth';
import { Context } from '../context';
import type { Progress, UserProgressList } from '../type';

export type FetchUserProgressList = (username: string) => Promise<void>;

export const useFetchUserProgressList = (): FetchUserProgressList => {
  const { loadingByUsername, setLoadingForUsername, setErrorForUsername, setProgressForUsername } =
    useContext(Context);
  const [isAdmin] = useIsAdmin();

  return useCallback(
    async (username: string) => {
      if (isAdmin !== true || loadingByUsername[username]) return;

      setLoadingForUsername(username, true);
      setErrorForUsername(username, undefined);
      try {
        const merged: UserProgressList = {};
        let cursor: string | null = null;
        const seenCursors = new Set<string>();
        do {
          const base = `/api/users/${encodeURIComponent(username)}/progress`;
          const url: string = cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
          const response = await apiFetch(url);
          if (!response.ok) throw new Error('Failed to fetch progress');
          const data = (await response.json()) as { items: Progress[]; nextCursor: string | null };
          for (const p of data.items) merged[p.document] = p;
          cursor = data.nextCursor;
          if (cursor !== null && cursor !== '') {
            if (seenCursors.has(cursor)) break;
            seenCursors.add(cursor);
          }
        } while (cursor !== null);
        setProgressForUsername(username, merged);
      } catch (err) {
        setErrorForUsername(username, err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoadingForUsername(username, false);
      }
    },
    [loadingByUsername, setLoadingForUsername, setErrorForUsername, setProgressForUsername, isAdmin]
  );
};

import { useCallback, useContext } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { useIsAdmin, useUsername } from '../../../provider/auth';
import { Context } from '../context';
import type { Progress, UserProgressList } from '../type';

export type FetchMyProgressList = () => Promise<void>;

export const useFetchMyProgressList = (): FetchMyProgressList => {
  const { loadingByUsername, setLoadingForUsername, setErrorForUsername, setProgressForUsername } =
    useContext(Context);
  const [username] = useUsername();
  const [isAdmin] = useIsAdmin();

  return useCallback(async () => {
    if (isAdmin === true || username === undefined) return;
    if (loadingByUsername[username]) return;

    setLoadingForUsername(username, true);
    setErrorForUsername(username, undefined);
    try {
      const merged: UserProgressList = {};
      let cursor: string | null = null;
      const seenCursors = new Set<string>();
      do {
        const url: string = cursor
          ? `/api/my/progress?cursor=${encodeURIComponent(cursor)}`
          : '/api/my/progress';
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
  }, [
    isAdmin,
    username,
    loadingByUsername,
    setLoadingForUsername,
    setErrorForUsername,
    setProgressForUsername,
  ]);
};

import { useCallback, use, useMemo, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import type { UserProgressList } from '../type';

const removeProgressById = (bookId: string, { [bookId]: _, ...rest }: UserProgressList) => rest;

export type DeleteUserProgress = (bookId: string) => Promise<boolean>;
export type UseDeleteUserProgress =
  | [DeleteUserProgress, false, false, undefined]
  | [DeleteUserProgress, true, false, undefined]
  | [DeleteUserProgress, false, true, undefined]
  | [DeleteUserProgress, false, true, string];

export const useDeleteUserProgress = (username?: string): UseDeleteUserProgress => {
  const { progressList, setProgressForUsername } = use(Context);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const deleteUserProgress = useCallback(
    async (bookId: string): Promise<boolean> => {
      if (deleting) return false;

      if (username === undefined) {
        setError(true);
        setErrorMessage('Failed to delete progress');
        return false;
      }

      const userProgressList = progressList[username];
      const progress = userProgressList?.[bookId];
      if (progress === undefined) {
        setError(true);
        setErrorMessage('Failed to delete progress');
        return false;
      }

      setProgressForUsername(username, removeProgressById(bookId, userProgressList));

      try {
        setDeleting(true);
        setError(false);
        setErrorMessage(undefined);
        const response = await apiFetch(
          `/api/users/${encodeURIComponent(username)}/progress/${encodeURIComponent(bookId)}`,
          { method: 'DELETE' }
        );
        if (response.status !== 204) throw new Error('Failed to clear progress');
        return true;
      } catch (err) {
        setError(true);
        setProgressForUsername(username, { ...userProgressList, [bookId]: progress });
        if (err instanceof Error) setErrorMessage(err.message);
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [progressList, setProgressForUsername, username, deleting]
  );

  return useMemo(
    () => [deleteUserProgress, deleting, error, errorMessage] as UseDeleteUserProgress,
    [deleteUserProgress, deleting, error, errorMessage]
  );
};

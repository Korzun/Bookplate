import { useCallback, useContext, useMemo, useState } from 'react';

import { Context } from '../context';
import type { UserProgressList } from '../type';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const removeProgressById = (bookId: string, { [bookId]: _, ...rest }: UserProgressList) => rest;

export type DeleteUserProgress = (bookId: string) => Promise<void>;
export type UseDeleteUserProgress =
  | [DeleteUserProgress, false, false, undefined]
  | [DeleteUserProgress, true, false, undefined]
  | [DeleteUserProgress, false, true, undefined]
  | [DeleteUserProgress, false, true, string];

export const useDeleteUserProgress = (username?: string): UseDeleteUserProgress => {
  const { progressList, setProgressForUsername } = useContext(Context);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const deleteUserProgress = useCallback(
    async (bookId: string) => {
      if (deleting) return;

      if (username === undefined) {
        setError(true);
        setErrorMessage('Failed to delete progress');
        return;
      }

      const userProgressList = progressList[username];
      const progress = userProgressList?.[bookId];
      if (progress === undefined) {
        setError(true);
        setErrorMessage('Failed to delete progress');
        return;
      }

      setProgressForUsername(username, removeProgressById(bookId, userProgressList));

      try {
        setDeleting(true);
        setError(false);
        setErrorMessage(undefined);
        const response = await fetch(
          `/api/users/${encodeURIComponent(username)}/progress/${encodeURIComponent(bookId)}`,
          { method: 'DELETE' }
        );
        if (response.status !== 204) throw new Error('Failed to clear progress');
      } catch (err) {
        setError(true);
        setProgressForUsername(username, { ...userProgressList, [bookId]: progress });
        if (err instanceof Error) setErrorMessage(err.message);
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

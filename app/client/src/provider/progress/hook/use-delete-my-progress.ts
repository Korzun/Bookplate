import { useCallback, useContext, useMemo, useState } from 'react';

import { useUsername } from '../../../provider/auth';
import { Context } from '../context';
import type { UserProgressList } from '../type';

const removeProgressById = (bookId: string, { [bookId]: _, ...rest }: UserProgressList) => rest;

export type DeleteMyProgress = (bookId: string) => Promise<void>;
export type UseDeleteMyProgress =
  | [DeleteMyProgress, false, false, undefined] // Initial State
  | [DeleteMyProgress, true, false, undefined] // Progress is being deleted
  | [DeleteMyProgress, false, true, undefined] // There was an unspecified error while deleting progress
  | [DeleteMyProgress, false, true, string]; // There was a specified error while deleting progress
export const useDeleteMyProgress = (): UseDeleteMyProgress => {
  const [username] = useUsername();
  const { progressList, setProgressForUsername } = useContext(Context);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const deleteMyProgress = useCallback(
    async (bookId: string) => {
      if (deleting || username === undefined) return;

      const userProgressList = progressList[username];
      const progress = userProgressList?.[bookId];
      if (progress === undefined) {
        setError(true);
        setErrorMessage('Failed to clear progress');
        return;
      }

      setProgressForUsername(username, removeProgressById(bookId, userProgressList));

      try {
        setDeleting(true);
        setError(false);
        setErrorMessage(undefined);
        const response = await fetch(`/api/my/progress/${encodeURIComponent(bookId)}`, {
          method: 'DELETE',
        });
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
    () => [deleteMyProgress, deleting, error, errorMessage] as UseDeleteMyProgress,
    [deleteMyProgress, deleting, error, errorMessage]
  );
};

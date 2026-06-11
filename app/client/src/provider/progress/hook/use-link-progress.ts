import { useCallback, useContext, useMemo, useRef, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import type { UserProgressList } from '../type';

function removeProgressById(documentId: string, progressList: UserProgressList): UserProgressList {
  return Object.fromEntries(Object.entries(progressList).filter(([key]) => key !== documentId));
}

export type LinkProgress = (documentId: string) => Promise<void>;
export type UseLinkProgress =
  | [LinkProgress, false, false, undefined]
  | [LinkProgress, true, false, undefined]
  | [LinkProgress, false, true, undefined]
  | [LinkProgress, false, true, string];

export const useLinkProgress = (bookId: string, username: string): UseLinkProgress => {
  const { progressList, setProgressForUsername } = useContext(Context);
  const [linking, setLinking] = useState(false);
  const linkingRef = useRef(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const link = useCallback(
    async (documentId: string) => {
      if (linkingRef.current) return;
      linkingRef.current = true;
      setLinking(true);
      setError(false);
      setErrorMessage(undefined);
      try {
        const response = await apiFetch(`/api/books/${encodeURIComponent(bookId)}/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId }),
        });
        if (response.status !== 204) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? 'Failed to link progress');
        }
        const userProgress = progressList[username];
        if (userProgress) {
          setProgressForUsername(username, removeProgressById(documentId, userProgress));
        }
      } catch (err) {
        setError(true);
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        linkingRef.current = false;
        setLinking(false);
      }
    },
    [bookId, username, progressList, setProgressForUsername]
  );

  return useMemo(
    () => [link, linking, error, errorMessage] as UseLinkProgress,
    [link, linking, error, errorMessage]
  );
};

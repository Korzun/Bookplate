import { useCallback, useContext, useMemo, useRef, useState } from 'react';

import { useIsAdmin } from '~/provider/auth';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import type { UserProgressList } from '../type';

/**
 * Mirror the server's linkDocument merge: the orphan progress migrates onto the
 * book, but if the book already has a strictly newer record the server keeps it
 * and drops the orphan. Missing timestamps sort oldest so the orphan wins on a
 * tie, matching the server's `>=` comparison.
 */
function mergeLinkedProgress(
  progressList: UserProgressList,
  documentId: string,
  bookId: string
): UserProgressList {
  const orphan = progressList[documentId];
  const { [documentId]: _removed, ...rest } = progressList;
  if (!orphan) return rest;
  const target = rest[bookId];
  const orphanWins = !target || (orphan.timestamp ?? 0) >= (target.timestamp ?? 0);
  if (!orphanWins) return rest;
  return { ...rest, [bookId]: { ...orphan, document: bookId } };
}

export type LinkProgress = (documentId: string) => Promise<void>;
export type UseLinkProgress =
  | [LinkProgress, false, false, undefined]
  | [LinkProgress, true, false, undefined]
  | [LinkProgress, false, true, undefined]
  | [LinkProgress, false, true, string];

export const useLinkProgress = (bookId: string, username: string): UseLinkProgress => {
  const { progressList, setProgressForUsername } = useContext(Context);
  const [isAdmin] = useIsAdmin();
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
        // Reached both from the admin Users page (admin session, scoped to the
        // row user via ?user=) and from a user's own progress view (non-admin,
        // acting on their own library). The server rejects ?user= from
        // non-admins, so only append the scope for admin sessions.
        const url = `/api/books/${encodeURIComponent(bookId)}/link`;
        const scopedUrl = isAdmin ? `${url}?user=${encodeURIComponent(username)}` : url;
        const response = await apiFetch(scopedUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId }),
        });
        if (response.status !== 204) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? 'Failed to link progress');
        }
        // The server migrated the orphan progress onto the linked book (its
        // `document` becomes bookId), so re-key the cached entry rather than
        // dropping it — otherwise the row vanishes from the Progress list.
        const userProgress = progressList[username];
        if (userProgress) {
          setProgressForUsername(username, mergeLinkedProgress(userProgress, documentId, bookId));
        }
      } catch (err) {
        setError(true);
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        linkingRef.current = false;
        setLinking(false);
      }
    },
    [isAdmin, bookId, username, progressList, setProgressForUsername]
  );

  return useMemo(
    () => [link, linking, error, errorMessage] as UseLinkProgress,
    [link, linking, error, errorMessage]
  );
};

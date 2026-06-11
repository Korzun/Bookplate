import { useCallback, useMemo, useRef, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';

export type UnlinkBookLineage = (documentId: string) => Promise<boolean>;
export type UseUnlinkBookLineage =
  | [UnlinkBookLineage, false, false, undefined]
  | [UnlinkBookLineage, true, false, undefined]
  | [UnlinkBookLineage, false, true, undefined]
  | [UnlinkBookLineage, false, true, string];

export const useUnlinkBookLineage = (bookId: string): UseUnlinkBookLineage => {
  const [unlinking, setUnlinking] = useState(false);
  const unlinkingRef = useRef(false);
  const withTargetUser = useWithTargetUser();
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const unlink = useCallback(
    async (documentId: string): Promise<boolean> => {
      if (unlinkingRef.current) return false;
      unlinkingRef.current = true;
      setUnlinking(true);
      setError(false);
      setErrorMessage(undefined);
      try {
        const response = await apiFetch(
          withTargetUser(
            `/api/books/${encodeURIComponent(bookId)}/link/${encodeURIComponent(documentId)}`
          ),
          { method: 'DELETE' }
        );
        if (response.status !== 204) {
          let message = 'Failed to unlink';
          try {
            const body = (await response.json()) as { error?: string };
            message = body.error ?? message;
          } catch {
            // non-JSON body — keep generic message
          }
          throw new Error(message);
        }
        return true;
      } catch (err) {
        setError(true);
        if (err instanceof Error) setErrorMessage(err.message);
        return false;
      } finally {
        unlinkingRef.current = false;
        setUnlinking(false);
      }
    },
    [bookId, withTargetUser]
  );

  return useMemo(
    () => [unlink, unlinking, error, errorMessage] as UseUnlinkBookLineage,
    [unlink, unlinking, error, errorMessage]
  );
};

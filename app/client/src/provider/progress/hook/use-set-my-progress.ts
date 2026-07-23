import { useCallback, use, useMemo, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { useUsername } from '../../../provider/auth';
import { generateUUID } from '../../../utils';
import { Context } from '../context';
import type { Progress } from '../type';

const DEVICE_ID_KEY = 'bookplate-device-id';

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = generateUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export type SetMyProgress = (args: { currentChapter: number; percentage: number }) => Promise<void>;
export type UseSetMyProgress =
  | [SetMyProgress, false, false, undefined]
  | [SetMyProgress, true, false, undefined]
  | [SetMyProgress, false, true, undefined]
  | [SetMyProgress, false, true, string];

export const useSetMyProgress = (bookId: string): UseSetMyProgress => {
  const { progressList, setProgressForUsername } = use(Context);
  const [username] = useUsername();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const setMyProgress = useCallback(
    async ({ currentChapter, percentage }: { currentChapter: number; percentage: number }) => {
      if (saving || username === undefined) return;

      const userProgressList = progressList[username] ?? {};
      const newProgress: Progress = { document: bookId, percentage, currentChapter };

      setProgressForUsername(username, { ...userProgressList, [bookId]: newProgress });

      try {
        setSaving(true);
        setError(false);
        setErrorMessage(undefined);
        const response = await apiFetch(`/api/my/progress/${encodeURIComponent(bookId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentChapter,
            percentage,
            device: 'Web',
            device_id: getOrCreateDeviceId(),
          }),
        });
        if (!response.ok) throw new Error('Failed to save progress');
      } catch (err) {
        setError(true);
        setProgressForUsername(username, userProgressList);
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setSaving(false);
      }
    },
    [progressList, setProgressForUsername, username, bookId, saving]
  );

  return useMemo(
    () => [setMyProgress, saving, error, errorMessage] as UseSetMyProgress,
    [setMyProgress, saving, error, errorMessage]
  );
};

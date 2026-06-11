import { useCallback, useMemo, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { setToken } from '../../../lib/token';

export type ChangeMyPassword = (currentPassword: string, newPassword: string) => Promise<boolean>;
export type UseChangeMyPassword =
  | [ChangeMyPassword, false, false, false, undefined] // Initial
  | [ChangeMyPassword, true, false, false, undefined] // Changing
  | [ChangeMyPassword, false, true, false, undefined] // Changed successfully
  | [ChangeMyPassword, false, false, true, undefined] // Unspecified error
  | [ChangeMyPassword, false, false, true, string]; // Specified error
export const useChangeMyPassword = (): UseChangeMyPassword => {
  const [loading, setLoading] = useState<boolean>(false);
  const [okay, setOkay] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const changeMyPassword = useCallback(async (currentPassword: string, newPassword: string) => {
    setOkay(false);

    if (!currentPassword || !newPassword) {
      setError(true);
      setErrorMessage('Current and new password are required');
      return false;
    }

    try {
      setLoading(true);
      setError(false);
      setErrorMessage(undefined);

      const response = await apiFetch('/api/my/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (response.status !== 200) {
        let message = 'Password change failed';
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          /* ignore parse error */
        }
        throw new Error(message);
      }
      const { accessToken } = (await response.json()) as { accessToken: string };
      setToken(accessToken);
      setOkay(true);
      return true;
    } catch (err) {
      setError(true);
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Password change failed');
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return useMemo(
    () => [changeMyPassword, loading, okay, error, errorMessage] as UseChangeMyPassword,
    [changeMyPassword, loading, okay, error, errorMessage]
  );
};

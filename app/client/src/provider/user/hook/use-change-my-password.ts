import { useCallback, useMemo, useState } from 'react';

export type ChangeMyPassword = (currentPassword: string, newPassword: string) => Promise<void>;
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
      return;
    }

    try {
      setLoading(true);
      setError(false);
      setErrorMessage(undefined);

      const response = await fetch('/api/my/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (response.status !== 204) {
        throw new Error('Password change failed');
      }
      setOkay(true);
    } catch (err) {
      setError(true);
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Password change failed');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return useMemo(
    () => [changeMyPassword, loading, okay, error, errorMessage] as UseChangeMyPassword,
    [changeMyPassword, loading, okay, error, errorMessage]
  );
};

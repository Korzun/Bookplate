import { useCallback, useMemo, useState } from 'react';

export type ResetUserPassword = (username: string) => Promise<string | null>;
export type UseResetUserPassword =
  | [ResetUserPassword, false, false, undefined] // Initial/ready
  | [ResetUserPassword, true, false, undefined] // Reset in progress
  | [ResetUserPassword, false, true, undefined] // Unspecified error
  | [ResetUserPassword, false, true, string]; // Specified error
export const useResetUserPassword = (): UseResetUserPassword => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const resetUserPassword = useCallback(async (username: string) => {
    try {
      setLoading(true);
      setError(false);
      setErrorMessage(undefined);

      const response = await fetch(`/api/users/${encodeURIComponent(username)}/reset-password`, {
        method: 'POST',
      });
      if (response.status !== 200) {
        let message = 'Failed to reset password';
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          /* ignore parse error */
        }
        throw new Error(message);
      }
      const data = (await response.json()) as { password: string };
      return data.password;
    } catch (err) {
      setError(true);
      if (err instanceof Error) {
        setErrorMessage(err.message);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return useMemo(
    () => [resetUserPassword, loading, error, errorMessage] as UseResetUserPassword,
    [resetUserPassword, loading, error, errorMessage]
  );
};

import { useCallback, useContext, useMemo, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import { removeUserByUsername } from './util';

export type RegisterUser = (username: string) => Promise<string | null>;
export type UseRegisterUser =
  | [RegisterUser, false, false, undefined] // Initial/ready
  | [RegisterUser, true, false, undefined] // Registering
  | [RegisterUser, false, true, undefined] // Unspecified error
  | [RegisterUser, false, true, string]; // Specified error
export const useRegisterUser = (): UseRegisterUser => {
  const { userList, setUserList } = useContext(Context);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const registerUser = useCallback(
    async (username: string): Promise<string | null> => {
      const normalizedUsername = username.trim();
      if (!normalizedUsername) {
        setError(true);
        setErrorMessage('Username is required');
        return null;
      }

      if (userList[normalizedUsername] !== undefined) {
        setError(true);
        setErrorMessage('Username already taken');
        return null;
      }

      setUserList((prev) => ({
        ...prev,
        [normalizedUsername]: { username: normalizedUsername, progressCount: 0 },
      }));

      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const response = await apiFetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: normalizedUsername }),
        });
        if (response.status !== 201) throw new Error('Registration failed');
        const data = (await response.json()) as { password: string };
        return data.password;
      } catch (err) {
        setError(true);
        setUserList((prev) => removeUserByUsername(normalizedUsername, prev));
        if (err instanceof Error) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage('Registration failed');
        }
        return null;
      } finally {
        setLoading(false);
      }
    },
    [userList, setUserList]
  );

  return useMemo(
    () => [registerUser, loading, error, errorMessage] as UseRegisterUser,
    [registerUser, loading, error, errorMessage]
  );
};

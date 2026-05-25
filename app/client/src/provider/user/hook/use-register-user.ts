import { useCallback, useContext, useMemo, useState } from 'react';

import { Context } from '../context';

import { removeUserByUsername } from './util';

export type RegisterUser = (username: string, password: string) => Promise<void>;
export type UseRegisterUser =
  | [RegisterUser, false, false, false, undefined] // Initial
  | [RegisterUser, true, false, false, undefined] // Registering
  | [RegisterUser, false, true, false, undefined] // Registered successfully
  | [RegisterUser, false, false, true, undefined] // Unspecified error
  | [RegisterUser, false, false, true, string]; // Specified error
export const useRegisterUser = (): UseRegisterUser => {
  const { userList, setUserList } = useContext(Context);
  const [loading, setLoading] = useState<boolean>(false);
  const [okay, setOkay] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const registerUser = useCallback(
    async (username: string, password: string) => {
      setOkay(false);

      if (!username.trim() || !password) {
        setError(true);
        setErrorMessage('Username and password are required');
        return;
      }

      if (userList[username] !== undefined) {
        setError(true);
        setErrorMessage('Username already taken');
        return;
      }

      setUserList((prev) => ({ ...prev, [username]: { username, progressCount: 0 } }));

      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const response = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (response.status !== 201) {
          throw new Error('Registration failed');
        }
        setOkay(true);
      } catch (err) {
        setError(true);
        setUserList((prev) => removeUserByUsername(username, prev));
        if (err instanceof Error) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage('Registration failed');
        }
      } finally {
        setLoading(false);
      }
    },
    [userList, setUserList]
  );

  return useMemo(
    () => [registerUser, loading, okay, error, errorMessage] as UseRegisterUser,
    [registerUser, loading, okay, error, errorMessage]
  );
};

import { useCallback, use, useMemo, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import { removeUserByUsername } from './util';

export type DeleteUser = (username: string) => Promise<void>;
export type UseDeleteUser =
  | [DeleteUser, false, false, undefined] // Initial/ready
  | [DeleteUser, true, false, undefined] // Delete in progress
  | [DeleteUser, false, true, undefined] // Unspecified error
  | [DeleteUser, false, true, string]; // Specified error
export const useDeleteUser = (): UseDeleteUser => {
  const { userList, setUserList } = use(Context);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const deleteUser = useCallback(
    async (username: string) => {
      const user = userList[username];
      if (user === undefined) {
        setError(true);
        setErrorMessage('Failed to delete user');
        return;
      }

      setUserList((prev) => removeUserByUsername(username, prev));

      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const response = await apiFetch(`/api/users/${encodeURIComponent(username)}`, {
          method: 'DELETE',
        });
        if (response.status !== 204) {
          throw new Error('Failed to delete user');
        }
      } catch (err) {
        setError(true);
        setUserList((prev) => ({ ...prev, [username]: user }));
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setLoading(false);
      }
    },
    [userList, setUserList]
  );

  return useMemo(
    () => [deleteUser, loading, error, errorMessage] as UseDeleteUser,
    [deleteUser, loading, error, errorMessage]
  );
};

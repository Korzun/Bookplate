import { useCallback, useContext, useEffect, useMemo } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';
import type { User } from '../type';

export const sortUserList = (userA: User, userB: User) =>
  userA.username.localeCompare(userB.username);

export type UseUserList =
  | [User[], true, false, undefined]
  | [User[], false, false, undefined]
  | [User[], false, true, undefined]
  | [User[], false, true, string];

export const useUserList = (): UseUserList => {
  const { userList, loading, error, setUserList, setLoading, setError } = useContext(Context);

  const getUserList = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await apiFetch('/api/users');
      const users = await (response.json() as Promise<User[]>);
      setUserList(() =>
        users.reduce(
          (record, user) => ({ ...record, [user.username]: user }),
          {} as Record<string, User>
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [setUserList, setLoading, setError]);

  useEffect(() => {
    if (!loading && error === undefined && Object.keys(userList).length === 0) {
      void getUserList();
    }
    // loading, error, and userList are intentionally excluded: this effect is meant to fire once on
    // mount. getUserList is stable so deps never change. Adding the others would cause a re-fetch
    // loop when the server legitimately returns zero users.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getUserList]);

  return useMemo(
    () =>
      [
        Object.values(userList).sort(sortUserList),
        loading,
        error !== undefined,
        error,
      ] as UseUserList,
    [userList, loading, error]
  );
};

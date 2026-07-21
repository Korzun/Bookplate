import { useMemo } from 'react';

import type { User } from '../type';
import { useUserList } from './use-user-list';

export type UseUser =
  | [User, false, false, undefined] // User was successfully loaded
  | [User, true, false, undefined] // User was loaded and list is being reloaded
  | [undefined, true, false, undefined] // User list is loading
  | [undefined, false, true, undefined] // Unspecified error
  | [undefined, false, true, string]; // Specified error
export const useUser = (username: string): UseUser => {
  const [userList, loading, error, errorMessage] = useUserList();

  return useMemo((): UseUser => {
    if (error) {
      return [undefined, false, error, errorMessage];
    }

    const user = userList.find((candidate) => candidate.username === username);

    if (user === undefined) {
      if (loading) {
        return [undefined, true, false, undefined];
      }
      return [undefined, false, true, `Unknown user ${username}`];
    }

    return [user, loading, false, undefined];
  }, [userList, loading, error, errorMessage, username]);
};

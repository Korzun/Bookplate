import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';

import { UserListDocument } from '~/graphql/user';

import type { User } from '../type';

export const sortUserList = (userA: User, userB: User) =>
  userA.username.localeCompare(userB.username);

export type UseUserList =
  | [User[], true, false, undefined]
  | [User[], false, false, undefined]
  | [User[], false, true, undefined]
  | [User[], false, true, string];

/**
 * The user list, read over GraphQL.
 *
 * `Viewer.users` is nullable (`[User!]`): a non-admin selecting it gets `null`
 * for that field rather than a failed operation, since a scope denial nulls
 * one field instead of failing the whole request. That `null` is treated as
 * "no list" here and folded into an empty array, NOT surfaced as an error —
 * only an actual GraphQL error populates the error slot.
 */
export const useUserList = (): UseUserList => {
  const { data, loading, error } = useQuery(UserListDocument);

  return useMemo(() => {
    if (error !== undefined) {
      return [[], false, true, error.message] as UseUserList;
    }

    const users: User[] = (data?.viewer.users ?? [])
      .map(
        (user): User => ({
          id: user.id,
          username: user.username,
          progressCount: user.progressCount,
        })
      )
      .sort(sortUserList);

    return [users, loading, false, undefined] as UseUserList;
  }, [data, loading, error]);
};

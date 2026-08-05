import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';

import { UserListDocument } from '~/graphql/user';
import { useIsAdmin } from '~/provider/auth';

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
 * `Viewer.users` is nullable (`[User!]`), but the server's test-pinned
 * contract (`app/server/graphql/schema/viewer/users.test.ts`) never returns
 * that `null` on its own: a non-admin denial returns `users: null` TOGETHER
 * WITH a `FORBIDDEN` GraphQL error. Apollo's default `errorPolicy: 'none'`
 * (unconfigured here) discards `data` entirely whenever an error is present,
 * so a real denial surfaces to this hook as `{ data: undefined, error }`, not
 * as a null field on live data — it takes the `error` branch below, not a
 * "null means empty" branch. There is deliberately no such branch.
 *
 * That leaves querying at all as the only thing worth guarding: every
 * non-admin visits `page/library`/`page/upload` (the app's default landing
 * pages) and `component/device-form`, which call this hook unconditionally.
 * Without `skip`, each of those would fire a `UserList` query the server
 * always answers `FORBIDDEN`, on ordinary navigation. `skip: !isAdmin` stops
 * that at the source, mirroring the REST-era hook's own admin-gated fetch.
 */
export const useUserList = (): UseUserList => {
  const [isAdmin] = useIsAdmin();
  const { data, loading, error } = useQuery(UserListDocument, { skip: !isAdmin });

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

import { useQuery } from '@apollo/client/react';

import { Page, UserList, UserRegister } from '~/component';
import { graphql } from '~/gql';
import { useIsAdmin } from '~/provider/auth';

/**
 * Composed at the ROUTE from `component/user-row`'s colocated
 * `UserRowFragment` — one request per screen, authored by the components
 * that use the data. `...UserRowFragment` below is resolved by name against
 * `component/user-row`'s own `graphql(...)` definition — codegen matches
 * fragments across files by name (its `documents` glob), not via a JS
 * import, so this document needs no import of that fragment to compile.
 *
 * `library { id }` rides alongside the spread rather than inside the
 * fragment itself: `UserRow` never renders it, but this is also the
 * document `component/device-form`, `page/library`, `page/upload`, and
 * `component/library-switcher` (plus `useWithTargetUser`) all reuse for
 * their own admin-user-list reads — imported from HERE, not duplicated —
 * and `library-switcher`/`useWithTargetUser` specifically need each user's
 * Library global id alongside their username.
 *
 * `Viewer.users` is admin-only and nullable. The server's test-pinned
 * contract (`app/server/graphql/schema/viewer/users.test.ts`) never returns
 * that `null` on its own: a non-admin denial returns `users: null` TOGETHER
 * WITH a `FORBIDDEN` GraphQL error, and Apollo's default `errorPolicy:
 * 'none'` discards `data` entirely whenever an error is present — so a real
 * denial surfaces as `{ data: undefined, error }`, never a null field on
 * live data. There is deliberately no "null folds to empty" branch anywhere
 * this document is read. `skip: !isAdmin` is what stops the request before
 * the server ever gets to deny it — every non-admin visits `page/library`/
 * `page/upload` (the app's default landing pages) and `component/
 * device-form`, all of which read this same document unconditionally.
 */
export const UserListDocument = graphql(`
  query UserList {
    viewer {
      users {
        ...UserRowFragment
        library {
          id
        }
      }
    }
  }
`);

export const UserListPage = () => {
  const [isAdmin] = useIsAdmin();
  const { data, loading } = useQuery(UserListDocument, { skip: !isAdmin });

  return (
    <Page>
      <UserRegister />
      <UserList users={data?.viewer.users ?? []} loading={loading} />
    </Page>
  );
};

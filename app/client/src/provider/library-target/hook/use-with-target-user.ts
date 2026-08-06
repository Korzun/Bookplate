import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { getApolloContext, useQuery } from '@apollo/client/react';
import { useCallback, useContext } from 'react';

import { UserListDocument } from '~/graphql/user';
import { useIsAdmin } from '~/provider/auth';

import { useLibraryTarget } from './use-library-target';

export type WithTargetUser = (url: string) => string;

/**
 * A real (but link-less, cache-less-in-practice) `ApolloClient`, used ONLY as
 * `useQuery`'s `client` override below when this hook renders outside any
 * `ApolloProvider`. `useQuery` (via `useApolloClient`) requires SOME client
 * to exist — it throws `invariant(!!client, ...)` BEFORE ever consulting
 * `skip`, so `skip: true` alone does not protect a provider-less render.
 *
 * Every real app tree has `ApolloRoot` as its outermost provider
 * (`App.tsx`), so this branch is dead code in production. It exists because
 * roughly a dozen REST book hooks (`useDeleteBook`, `useFetchBook`, …) call
 * `useWithTargetUser`, and none of their own unit tests wire up an
 * `ApolloProvider` — this hook had zero Apollo dependency before this task.
 * Requiring `ApolloProvider` in each of those tests would widen this task
 * from 2 files to ~18 for a property none of them actually exercise; this
 * keeps that blast radius at zero while staying fully reactive wherever a
 * real client — and therefore real `UserListDocument` data — is present.
 */
const NO_PROVIDER_CLIENT = new ApolloClient({
  link: ApolloLink.empty(),
  cache: new InMemoryCache(),
});

/**
 * Returns a function that appends ?user=<target> to book API URLs when an
 * admin has a library selected. For regular users it returns URLs unchanged —
 * the server scopes requests to their own library.
 *
 * `library-target` stores a Library global ID (Task 3), not a username — but
 * the REST book endpoints this hook feeds still take `?user=<username>`. This
 * hook is the bridge: it resolves the selected library's owning username by
 * matching `targetLibraryId` against `UserListDocument`'s `library.id` for
 * each user, the same admin user list `LibrarySwitcher` reads. Matching, not
 * decoding — `targetLibraryId` is `encodeGlobalID('Library', userId)`, but
 * recovering the userId by decoding it client-side would re-implement a
 * server-only encoding concern here (this project's `atob`/`btoa` ban on
 * client-side global ID handling).
 *
 * `skip: !isAdmin || !contextClient` mirrors `useUserList`'s own admin guard
 * (`Viewer.users` is admin-gated; see that hook's doc comment for why an
 * unguarded query would fire a `FORBIDDEN` request on every non-admin visit),
 * with the provider-less case folded into the same flag — see
 * `NO_PROVIDER_CLIENT` above.
 */
export const useWithTargetUser = (): WithTargetUser => {
  const [isAdmin] = useIsAdmin();
  const [targetLibraryId] = useLibraryTarget();
  const { client: contextClient } = useContext(getApolloContext());
  const { data } = useQuery(UserListDocument, {
    client: contextClient ?? NO_PROVIDER_CLIENT,
    skip: !isAdmin || !contextClient,
  });

  const targetUsername = data?.viewer.users?.find(
    (user) => user.library.id === targetLibraryId
  )?.username;

  return useCallback(
    (url: string) => {
      if (!isAdmin || !targetUsername) return url;
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}user=${encodeURIComponent(targetUsername)}`;
    },
    [isAdmin, targetUsername]
  );
};

import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';

import { UserListDocument } from '~/graphql/user';
import { useIsAdmin } from '~/provider/auth';

import { useLibraryTarget } from './use-library-target';

export type WithTargetUser = {
  (url: string): string;
  /**
   * False only during the brief window on a cold admin load where
   * `targetLibraryId` has already restored synchronously from
   * `localStorage` but `UserListDocument` hasn't answered yet — true the
   * rest of the time (immediately, for a non-admin, since the query is
   * `skip`ped and never enters a loading state).
   *
   * `useFetchBookList` is the one caller that must gate on this: calling
   * the mapper before it's ready silently omits `?user=` from an admin's
   * REST book request, which the server 400s — see that file's own doc
   * comment for the full failure chain this closes.
   */
  ready: boolean;
};

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
 * `skip: !isAdmin` mirrors `useUserList`'s own admin guard (`Viewer.users` is
 * admin-gated; see that hook's doc comment for why an unguarded query would
 * fire a `FORBIDDEN` request on every non-admin visit).
 *
 * This hook requires an `ApolloProvider` ancestor unconditionally (a bare
 * `useQuery` call, no fallback client) — every real app tree has one
 * (`ApolloRoot`, `App.tsx`'s outermost provider). A subtree that escapes it
 * is a real bug, and Apollo's own invariant is the right way to surface
 * that loudly; every unit test that reaches this hook carries its own
 * (possibly empty-mock) `ApolloProvider` for exactly this reason.
 */
export const useWithTargetUser = (): WithTargetUser => {
  const [isAdmin] = useIsAdmin();
  const [targetLibraryId] = useLibraryTarget();
  const { data, loading } = useQuery(UserListDocument, { skip: !isAdmin });

  const targetUsername = data?.viewer.users?.find(
    (user) => user.library.id === targetLibraryId
  )?.username;
  const ready = !loading;

  // A fresh function object every time `isAdmin`/`targetUsername`/`ready`
  // changes — NOT a mutate-in-place `Object.assign` on a stable `useCallback`
  // reference. `use-fetch-book-list.ts` depends on THIS reference to decide
  // whether to retry a fetch it deferred while `ready` was false; a mutation
  // that kept the same identity across the false→true flip would leave that
  // retry permanently unscheduled (`ready` changing without the reference
  // changing is invisible to a `useCallback`/`useEffect` dependency array).
  return useMemo(() => {
    const withTargetUser = ((url: string) => {
      if (!isAdmin || !targetUsername) return url;
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}user=${encodeURIComponent(targetUsername)}`;
    }) as WithTargetUser;
    withTargetUser.ready = ready;
    return withTargetUser;
  }, [isAdmin, targetUsername, ready]);
};

import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';

import { UserRowFragment } from '~/component/user-row';
import { useFragment } from '~/gql';
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
   * NO LIVE CONSUMER TODAY (end-of-project doc sweep). `useFetchBookList`
   * was the one caller that gated on this — calling the mapper before it
   * was ready silently omitted `?user=` from an admin's REST book request,
   * which the server 400s — and that hook is DELETED. The remaining callers
   * (`provider/upload/hook/use-upload-transport.ts`,
   * `lib/use-download-book.ts`) invoke the mapper and never read `.ready`.
   * The field and its contract are kept because the hazard is intrinsic to
   * the mapper, not to that one caller: any future consumer that builds an
   * admin-scoped REST URL has the same window to fall into. It is pinned by
   * `use-with-target-user.test.tsx`, not by a call site.
   */
  ready: boolean;
  /**
   * The resolved username once `ready`, or `undefined` if either there is no
   * stored selection or the stored selection matches no user in the list
   * (deleted owner, or an id stale across installs) — the same "no match"
   * case whether ready is reached because a real query settled or because a
   * non-admin's `skip` short-circuits it immediately.
   *
   * Also has no live consumer today, for the same reason as `ready` above:
   * `useFetchBookList` gated on THIS too (round-2 review, the 400-latch
   * fix) — once `ready`, an admin with a `targetLibraryId` but no
   * `username` can never build a request the server would accept, every
   * such request 400s, so that hook cleared the stale selection itself
   * rather than ever sending it — and that hook is deleted. The self-heal
   * it performed is now `component/library-switcher`'s effect (target
   * missing from the user list) and `use-current-library-id.ts`'s
   * `LibraryTargetResolveDocument` branch (target resolves to nothing).
   */
  username: string | undefined;
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
 * `skip: !isAdmin` mirrors `UserListDocument`'s own admin guard (`Viewer.
 * users` is admin-gated; see that document's own doc comment (`~/graphql/
 * user`) for why an unguarded query would fire a `FORBIDDEN` request on
 * every non-admin visit).
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

  const userRefs = data?.viewer.users ?? [];
  const unmaskedUsers = useFragment(UserRowFragment, userRefs);
  const matchIndex = userRefs.findIndex((ref) => ref.library.id === targetLibraryId);
  const targetUsername = matchIndex === -1 ? undefined : unmaskedUsers[matchIndex].username;
  const ready = !loading;

  // A fresh function object every time `isAdmin`/`targetUsername`/`ready`
  // changes — NOT a mutate-in-place `Object.assign` on a stable `useCallback`
  // reference. The concrete caller this was written for,
  // `use-fetch-book-list.ts`, is DELETED (end-of-project doc sweep); it
  // depended on THIS reference to decide whether to retry a fetch it had
  // deferred while `ready` was false. The reasoning outlives it: a mutation
  // that kept the same identity across the false→true flip leaves any such
  // retry permanently unscheduled, because `ready` changing without the
  // reference changing is invisible to a `useCallback`/`useEffect`
  // dependency array. The test below ("returns a new function reference when
  // ready flips…") is what pins it now.
  return useMemo(() => {
    const withTargetUser = ((url: string) => {
      if (!isAdmin || !targetUsername) return url;
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}user=${encodeURIComponent(targetUsername)}`;
    }) as WithTargetUser;
    withTargetUser.ready = ready;
    withTargetUser.username = targetUsername;
    return withTargetUser;
  }, [isAdmin, targetUsername, ready]);
};

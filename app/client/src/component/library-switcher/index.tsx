import { useQuery } from '@apollo/client/react';
import { useEffect, useMemo } from 'react';

import { UserRowFragment } from '~/component/user-row';
import { Select } from '~/control';
import { useFragment } from '~/gql';
import { UserListDocument } from '~/graphql/user';
import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget } from '~/provider/library-target';

/**
 * `UserListDocument` is imported from the leaf module `~/graphql/user` (it
 * has multiple readers — see its own doc comment), not duplicated — no
 * `skip` gate here (unlike `page/library`/`page/upload`'s own reads of the
 * same document): `AdminLibrarySwitcher` is itself only ever mounted for an
 * admin (`LibrarySwitcher` below returns `null` before rendering it), so the
 * query is never even constructed for a non-admin, let alone sent.
 *
 * `library { id }` travels alongside the spread as a plain field (not part
 * of `UserRowFragment` itself, which `UserRow` alone owns) — this component
 * needs each user's Library global id, not just their username.
 */
const AdminLibrarySwitcher = () => {
  const [targetLibraryId, setTargetLibraryId] = useLibraryTarget();
  const { data, loading, error } = useQuery(UserListDocument);
  const hasError = error !== undefined;
  // Memoized on `data` itself: a new `[]` literal on every render (when
  // `data` is still `undefined`) would otherwise defeat `userList`'s own
  // memoization below.
  const userRefs = useMemo(() => data?.viewer.users ?? [], [data]);
  const unmaskedUsers = useFragment(UserRowFragment, userRefs);
  // Memoized on the ACTUAL data, not recomputed fresh every render: a new
  // array identity on every render (e.g. from `targetLibraryId` changing
  // while this component's own query result is unchanged) would otherwise
  // re-trigger the `useEffect` below on every keystroke/selection and
  // confuse `Select`'s own reactive `options` handling.
  const userList = useMemo(
    () =>
      userRefs.map((ref, index) => ({
        username: unmaskedUsers[index].username,
        library: { id: ref.library.id },
      })),
    [userRefs, unmaskedUsers]
  );
  const noUsers = !loading && userList.length === 0;

  // The target is restored from localStorage, which can go stale (user
  // deleted, or a dev database swap). Once the user list has actually
  // loaded, clear a target whose Library id no longer names a real user so
  // the page falls back to the "Select a library" state instead of failing
  // to fetch a dead library. An empty list is skipped: it is
  // indistinguishable from "not fetched yet".
  useEffect(() => {
    if (loading || hasError || userList.length === 0 || targetLibraryId === undefined) return;
    if (!userList.some((user) => user.library.id === targetLibraryId)) {
      setTargetLibraryId(undefined);
    }
  }, [loading, hasError, userList, targetLibraryId, setTargetLibraryId]);

  const options = useMemo(
    () => userList.map((user) => ({ label: user.username, value: user.library.id })),
    [userList]
  );

  return (
    <Select
      name="library"
      value={targetLibraryId}
      onChange={setTargetLibraryId}
      options={options}
      placeholder={noUsers ? 'No users registered' : 'Select library…'}
      loading={loading}
      disabled={noUsers}
    />
  );
};

export const LibrarySwitcher = () => {
  const [isAdmin] = useIsAdmin();

  if (!isAdmin) {
    return null;
  }

  return <AdminLibrarySwitcher />;
};

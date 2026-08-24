import { useEffect } from 'react';

import { Select } from '~/control';
import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget } from '~/provider/library-target';
import { useUserList } from '~/provider/user';

const AdminLibrarySwitcher = () => {
  const [targetLibraryId, setTargetLibraryId] = useLibraryTarget();
  const [userList, loading, hasError] = useUserList();
  const noUsers = !loading && userList.length === 0;

  // The target is restored from localStorage, which can go stale (user
  // deleted, or a dev database swap). Once the user list has actually
  // loaded, clear a target whose Library id no longer names a real user so
  // the page falls back to the "Select a library" state instead of failing
  // to fetch a dead library. An empty list is skipped: it is
  // indistinguishable from "not fetched yet".
  //
  // As of Task 9, `useFetchBookList` has ZERO live callers: `page/library`
  // stopped calling it once Task 11 moved the grid onto GraphQL pagination,
  // `page/series`'s `useSeriesBookList` was decoupled from that same
  // Context-wide REST list when `CoverStack` moved to GraphQL (the C-1 fix),
  // and Task 9 deleted both remaining ACTION-triggered callers —
  // `useUploadQueueEngine` (the old `use-upload-queue.ts`) and
  // `useScanLibrary` now runs entirely on GraphQL (`use-scan-library.ts`,
  // via `LibraryScanDocument` + `useScanProgress`) and never touches it.
  // `useFetchBookList`'s only remaining importers are `use-book-list.ts` and
  // `use-upload-book-list.ts`, both themselves dead and owned by step 10.
  //
  // So THIS effect is now the ONLY thing that clears a stale target from the
  // user-list angle (the target library id no longer names a real user).
  // The other angle a fetch failure used to cover — the target resolving to
  // no library at all — now lives in `useCurrentLibraryId`
  // (`use-current-library-id.ts`, Task 11), re-homed from
  // `useFetchBookList`'s old dead-404 branch.
  useEffect(() => {
    if (loading || hasError || userList.length === 0 || targetLibraryId === undefined) return;
    if (!userList.some((user) => user.library.id === targetLibraryId)) {
      setTargetLibraryId(undefined);
    }
  }, [loading, hasError, userList, targetLibraryId, setTargetLibraryId]);

  return (
    <Select
      name="library"
      value={targetLibraryId}
      onChange={setTargetLibraryId}
      options={userList.map((user) => ({ label: user.username, value: user.library.id }))}
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

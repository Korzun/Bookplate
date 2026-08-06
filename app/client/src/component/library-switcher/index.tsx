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
  // `useFetchBookList` (Task 4) still clears this same condition once it
  // actually attempts a fetch — but re-review correction: NOT "on screens
  // that call `useBookList`/`useFetchBookList`, today only `page/library`".
  // `page/library` stopped calling either hook once Task 11 moved the grid
  // onto GraphQL pagination, and `page/series`'s `useSeriesBookList` was
  // decoupled from that same Context-wide REST list in the C-1 fix that
  // made `CoverStack` read off GraphQL instead. `useBookList` and
  // `useStandaloneBookList` ARE now fully dead (no live caller) — but
  // `useFetchBookList` itself is not: it still fires from two ACTION-
  // triggered call sites, `useUploadQueueEngine` (`use-upload-queue.ts`,
  // invoked after a completed upload — `UploadProvider` mounts globally in
  // `App.tsx`, so this can fire from any screen) and `useScanLibrary`
  // (`use-scan-library.ts`, invoked after a completed scan, reached via
  // `page/user`'s `ScanLibrarySetting`). Neither is triggered merely by
  // visiting a screen this switcher renders on (`page/library`,
  // `page/upload`) — both need a real upload or scan to actually finish
  // first. THIS effect is the only one that clears a stale target
  // PROACTIVELY, the moment the switcher itself renders with one, without
  // waiting on an upload or scan to complete — that is what it is not
  // redundant with, not "nothing else ever clears it at all".
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

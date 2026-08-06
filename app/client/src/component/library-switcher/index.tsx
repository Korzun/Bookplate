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
  // `useFetchBookList` (Task 4) already clears this same condition once it
  // actually attempts a fetch (`ready && isAdmin && !username`) — but that
  // path only runs on screens that call `useBookList`/`useFetchBookList`,
  // which today is only `page/library`. `page/upload` mounts this switcher
  // too, and its own book-list refresh (`useUploadQueue`) only fires
  // `fetchBookList` reactively, after a successful upload — not on mount. A
  // ghost target sitting in `localStorage` would otherwise survive
  // indefinitely on that screen until the admin uploads something. This
  // effect is the one path that clears it promptly everywhere the switcher
  // itself is rendered, so it stays — it is not redundant with Task 4's.
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

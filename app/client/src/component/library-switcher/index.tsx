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
  // `useFetchBookList` (Task 4) used to clear this same condition once it
  // actually attempted a fetch (`ready && isAdmin && !username`) — final-
  // branch-review cleanup: that was already false in both directions by the
  // time this comment was last touched. `page/library` stopped calling
  // `useBookList`/`useFetchBookList` at all once Task 11 moved the grid onto
  // GraphQL pagination, and `page/series`'s `useSeriesBookList` (the one
  // other candidate) was decoupled from that same Context-wide REST list in
  // the C-1 fix that made `CoverStack` read off GraphQL instead — so nothing
  // in this app calls `useFetchBookList` today at all (`useBookList`,
  // `useFetchBookList`, and `useStandaloneBookList` are dead code left in
  // place deliberately, same as this plan's other carried dead exports).
  // This effect is consequently the ONLY thing anywhere that clears a
  // `targetLibraryId` naming a deleted/stale user — it stays for that
  // reason alone, not because some other path is "not quite" covering it.
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

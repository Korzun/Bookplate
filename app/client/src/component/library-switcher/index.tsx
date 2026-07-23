import { useEffect } from 'react';

import { Select } from '~/control';
import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget } from '~/provider/library-target';
import { useUserList } from '~/provider/user';

const AdminLibrarySwitcher = () => {
  const [targetUsername, setTargetUsername] = useLibraryTarget();
  const [userList, loading, hasError] = useUserList();
  const noUsers = !loading && userList.length === 0;

  // The target is restored from localStorage, which can go stale (user deleted,
  // or a dev database swap). Once the user list has actually loaded, clear a
  // target that no longer names a real user so the page falls back to the
  // "Select a library" state instead of failing to fetch a dead library. An
  // empty list is skipped: it is indistinguishable from "not fetched yet".
  useEffect(() => {
    if (loading || hasError || userList.length === 0 || targetUsername === undefined) return;
    if (!userList.some((user) => user.username === targetUsername)) {
      setTargetUsername(undefined);
    }
  }, [loading, hasError, userList, targetUsername, setTargetUsername]);

  return (
    <Select
      name="library"
      value={targetUsername}
      onChange={setTargetUsername}
      options={userList.map((user) => user.username)}
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

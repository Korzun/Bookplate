import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget } from '~/provider/library-target';
import { useUserList } from '~/provider/user';

import { useStyle } from './style';

const AdminLibrarySwitcher = () => {
  const styles = useStyle();
  const [targetUsername, setTargetUsername] = useLibraryTarget();
  const [userList] = useUserList();

  return (
    <select
      className={styles.root}
      aria-label="Library"
      value={targetUsername ?? ''}
      onChange={(e) => setTargetUsername(e.target.value || undefined)}
    >
      <option value="">Select library…</option>
      {userList.map((user) => (
        <option key={user.username} value={user.username}>
          {user.username}
        </option>
      ))}
    </select>
  );
};

export const LibrarySwitcher = () => {
  const [isAdmin] = useIsAdmin();

  if (!isAdmin) {
    return null;
  }

  return <AdminLibrarySwitcher />;
};

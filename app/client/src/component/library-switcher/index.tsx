import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget } from '~/provider/library-target';
import { useUserList } from '~/provider/user';

import { useStyle } from './style';

export const LibrarySwitcher = () => {
  const styles = useStyle();
  const [isAdmin] = useIsAdmin();
  const [targetUsername, setTargetUsername] = useLibraryTarget();
  const [userList] = useUserList();

  if (!isAdmin) {
    return null;
  }

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

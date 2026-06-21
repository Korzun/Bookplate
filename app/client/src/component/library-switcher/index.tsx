import { Select } from '~/control';
import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget } from '~/provider/library-target';
import { useUserList } from '~/provider/user';

const AdminLibrarySwitcher = () => {
  const [targetUsername, setTargetUsername] = useLibraryTarget();
  const [userList, loading] = useUserList();

  return (
    <Select
      name="library"
      value={targetUsername}
      onChange={setTargetUsername}
      options={userList.map((user) => user.username)}
      placeholder="Select library…"
      loading={loading}
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

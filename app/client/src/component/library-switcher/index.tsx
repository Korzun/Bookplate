import { Select } from '~/control';
import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget } from '~/provider/library-target';
import { useUserList } from '~/provider/user';

const AdminLibrarySwitcher = () => {
  const [targetUsername, setTargetUsername] = useLibraryTarget();
  const [userList, loading] = useUserList();
  const noUsers = !loading && userList.length === 0;

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

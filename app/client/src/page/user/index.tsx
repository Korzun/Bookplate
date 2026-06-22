import { useCallback } from 'react';

import { Page, MyProgress, UserChangePassword, SyncPassword } from '~/component';
import { Button } from '~/control';
import { useIsAdmin, useLogout } from '~/provider/auth';

export const UserPage = () => {
  const [isAdmin] = useIsAdmin();

  const [logout, loggingOut] = useLogout();
  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  if (isAdmin) {
    return (
      <Page>
        <Button loading={loggingOut} onClick={handleLogout} danger>
          Log out
        </Button>
      </Page>
    );
  }

  return (
    <Page>
      <SyncPassword />
      <UserChangePassword />
      <MyProgress />
      <Button loading={loggingOut} onClick={handleLogout} danger>
        Log out
      </Button>
    </Page>
  );
};

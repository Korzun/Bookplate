import { useCallback } from 'react';

import { Page, MyProgress } from '~/component';
import { Button } from '~/control';
import { useIsAdmin, useLogout } from '~/provider/auth';

export const UserPage = () => {
  const [isAdmin] = useIsAdmin();

  const [logout, loggingOut] = useLogout();
  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  return (
    <Page>
      {!isAdmin && <MyProgress />}
      <Button loading={loggingOut} onClick={handleLogout} danger>
        Log out
      </Button>
    </Page>
  );
};

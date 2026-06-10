import { Fragment, useCallback } from 'react';

import { Page, MyProgress, UserChangePassword, SyncPassword } from '~/component';
import { Button } from '~/control';
import { useIsAdmin, useLogout, useMustChangePassword } from '~/provider/auth';

import { useStyle } from './style';

export const UserPage = () => {
  const styles = useStyle();
  const [isAdmin] = useIsAdmin();
  const [mustChangePassword] = useMustChangePassword();

  const [logout, loggingOut] = useLogout();
  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  return (
    <Page>
      <Button loading={loggingOut} onClick={handleLogout} danger>
        Log out
      </Button>
      {mustChangePassword && (
        <div className={styles.banner}>You must change your password before continuing.</div>
      )}
      {!isAdmin && (
        <Fragment>
          <UserChangePassword />
          {!mustChangePassword && (
            <Fragment>
              <SyncPassword />
              <MyProgress />
            </Fragment>
          )}
        </Fragment>
      )}
    </Page>
  );
};

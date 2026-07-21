import { Fragment, useCallback, useState } from 'react';

import { Button, ConfirmModal, ResetPasswordButton } from '~/control';
import { AlertOctagonIcon } from '~/icon';
import { useDeleteUser, useUser } from '~/provider/user';

import { Card } from '../card';
import { UserRowContent } from '../user-row-content';
import { useStyle } from './style';

interface UserRowProps {
  username: string;
}

export const UserRow = ({ username }: UserRowProps) => {
  const styles = useStyle();
  const [user] = useUser(username);

  const [deleteUser, deleting] = useDeleteUser();

  const [showDeleteUserModal, setShowDeleteUserModal] = useState<boolean>(false);
  const handleDeleteUser = useCallback(() => {
    setShowDeleteUserModal(true);
  }, []);
  const handleDeleteUserCancel = useCallback(() => {
    setShowDeleteUserModal(false);
  }, []);
  const handleDeleteUserConfirm = useCallback(() => {
    setShowDeleteUserModal(false);
    deleteUser(username);
  }, [deleteUser, username]);

  return (
    <Fragment>
      <Card
        isCollapsible
        defaultCollapsed
        title={username}
        subTitle={
          user
            ? `${user.progressCount} book${user.progressCount === 1 ? '' : 's'} synced`
            : undefined
        }
        headerAction={
          <Fragment>
            <ResetPasswordButton username={username} />
            <Button type="link" danger onClick={handleDeleteUser} loading={deleting}>
              Delete user
            </Button>
          </Fragment>
        }
      >
        <div className={styles.content}>
          <UserRowContent username={username} />
        </div>
      </Card>
      <ConfirmModal
        isOpen={showDeleteUserModal}
        onCancel={handleDeleteUserCancel}
        onConfirm={handleDeleteUserConfirm}
        icon={AlertOctagonIcon}
        danger
        title={`Delete user permanently?`}
        confirmText="Delete"
      >
        This action will delete <span className={styles.username}>{username}</span>, all their
        reading progress, and <span className={styles.undone}>can not be undone</span>.
      </ConfirmModal>
    </Fragment>
  );
};

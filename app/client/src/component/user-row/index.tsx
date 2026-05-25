import cx from 'classnames';
import { Fragment, useCallback, useState } from 'react';

import { Button, ConfirmModal } from '~/control';
import { AlertOctagonIcon, ChevronCircleIcon } from '~/icon';
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

  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const handleExpandToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

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
        onClickHeader={handleExpandToggle}
        title={
          <div className={styles.title}>
            <ChevronCircleIcon
              className={cx(styles.chevron, isExpanded ? styles.expanded : styles.collapsed)}
            />
            {username}
          </div>
        }
        subTitle={
          user
            ? `${user.progressCount} book${user.progressCount === 1 ? '' : 's'} synced`
            : undefined
        }
        headerAction={
          <Button type="link" danger onClick={handleDeleteUser} loading={deleting}>
            Delete user
          </Button>
        }
      >
        {isExpanded && (
          <div className={styles.content}>
            <UserRowContent username={username} />
          </div>
        )}
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

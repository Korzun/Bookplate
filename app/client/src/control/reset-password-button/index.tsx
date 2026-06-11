import { Fragment, useCallback, useState } from 'react';

import { useToast } from '~/provider/toast';
import { useResetUserPassword } from '~/provider/user';

import { Button } from '../button';
import { ConfirmModal } from '../confirm-modal';
import { PasswordResultModal } from '../password-result-modal';

interface ResetPasswordButtonProps {
  username: string;
}

export const ResetPasswordButton = ({ username }: ResetPasswordButtonProps) => {
  const [resetUserPassword, resetting] = useResetUserPassword();
  const showToast = useToast();

  const [showConfirm, setShowConfirm] = useState(false);
  const [password, setPassword] = useState<string | null>(null);

  const showResult = password !== null;

  const handleClick = useCallback(() => setShowConfirm(true), []);
  const handleCancel = useCallback(() => setShowConfirm(false), []);
  const handleConfirm = useCallback(async () => {
    setShowConfirm(false);
    const newPassword = await resetUserPassword(username);
    if (newPassword === null) {
      showToast('Failed to reset password', 'error');
    } else {
      setPassword(newPassword);
    }
  }, [resetUserPassword, username, showToast]);
  const handleDone = useCallback(() => {
    setPassword(null);
  }, []);

  return (
    <Fragment>
      <Button type="link" onClick={handleClick} loading={resetting}>
        Reset password
      </Button>
      <ConfirmModal
        isOpen={showConfirm}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        title={`Reset password for ${username}?`}
        confirmText="Reset password"
      >
        This generates a new login password and signs them in fresh — they&apos;ll be required to
        change it on their next login. The new password will be shown once; make sure to copy it
        before closing.
      </ConfirmModal>
      <PasswordResultModal
        isOpen={showResult}
        username={username}
        password={password}
        onDone={handleDone}
      />
    </Fragment>
  );
};

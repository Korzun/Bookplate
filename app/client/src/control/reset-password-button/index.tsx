import { Fragment, useCallback, useState } from 'react';

import { Toast } from '~/component';
import { useResetUserPassword } from '~/provider/user';

import { Button } from '../button';
import { ConfirmModal } from '../confirm-modal';
import { PasswordResultModal } from '../password-result-modal';

interface ResetPasswordButtonProps {
  username: string;
}

export const ResetPasswordButton = ({ username }: ResetPasswordButtonProps) => {
  const [resetUserPassword, resetting, resetError] = useResetUserPassword();

  const [showConfirm, setShowConfirm] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const [dismissedCount, setDismissedCount] = useState(0);

  const showResult = password !== null;
  const toast = (() => {
    if (resetCount === 0 || dismissedCount >= resetCount || resetting) return null;
    if (resetError) return { text: 'Failed to reset password', type: 'error' as const };
    return null;
  })();

  const handleClick = useCallback(() => setShowConfirm(true), []);
  const handleCancel = useCallback(() => setShowConfirm(false), []);
  const handleConfirm = useCallback(() => {
    setShowConfirm(false);
    setResetCount((c) => c + 1);
    void resetUserPassword(username).then(setPassword);
  }, [resetUserPassword, username]);
  const handleDone = useCallback(() => {
    setPassword(null);
  }, []);
  const handleToastDismiss = useCallback(() => setDismissedCount(resetCount), [resetCount]);

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
      {toast && (
        <Toast
          key={resetCount}
          message={toast.text}
          type={toast.type}
          onDismiss={handleToastDismiss}
        />
      )}
    </Fragment>
  );
};

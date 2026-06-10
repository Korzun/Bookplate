import { Fragment, useCallback, useEffect, useState } from 'react';

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
  const [showResult, setShowResult] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (resetCount === 0) return;
    if (resetting) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToast(null);
      return;
    }
    if (resetError) {
      setToast({ text: 'Failed to reset password', type: 'error' });
      return;
    }
    if (password) {
      setShowResult(true);
    }
  }, [resetCount, resetting, resetError, password]);

  const handleClick = useCallback(() => setShowConfirm(true), []);
  const handleCancel = useCallback(() => setShowConfirm(false), []);
  const handleConfirm = useCallback(() => {
    setShowConfirm(false);
    setResetCount((c) => c + 1);
    void resetUserPassword(username).then(setPassword);
  }, [resetUserPassword, username]);
  const handleDone = useCallback(() => {
    setShowResult(false);
    setPassword(null);
  }, []);
  const handleToastDismiss = useCallback(() => setToast(null), []);

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

import { Fragment, useCallback, useState } from 'react';

import { Card, Toast } from '~/component';
import { Button, TextInput } from '~/control';
import { useAuthRefresh } from '~/provider/auth';
import { useChangeMyPassword } from '~/provider/user';

import { useStyle } from './style';

export const UserChangePassword = () => {
  const styles = useStyle();
  const refetchAuth = useAuthRefresh();
  const [changeMyPassword, loading, okay, error, errorMessage] = useChangeMyPassword();
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isPasswordValid, setIsPasswordValid] = useState<boolean>(false);
  const [submitCount, setSubmitCount] = useState(0);
  const [dismissedCount, setDismissedCount] = useState(0);
  const handleDismiss = useCallback(() => setDismissedCount(submitCount), [submitCount]);

  const toast = (() => {
    if (submitCount === 0 || dismissedCount >= submitCount || loading) return null;
    if (error) return { text: errorMessage ?? 'Password change failed', type: 'error' as const };
    if (okay) return { text: 'Password changed', type: 'success' as const };
    return null;
  })();

  const handleChangePassword = useCallback(() => {
    setSubmitCount((count) => count + 1);
    void changeMyPassword(currentPassword, newPassword).then((changed) => {
      if (!changed) return;
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsPasswordValid(false);
      void refetchAuth();
    });
  }, [changeMyPassword, currentPassword, newPassword, refetchAuth]);

  const handleCurrentPasswordChange = useCallback((newValue: string | undefined) => {
    setCurrentPassword(newValue ?? '');
  }, []);
  const handleNewPasswordChange = useCallback((newValue: string | undefined) => {
    setNewPassword(newValue ?? '');
    setConfirmPassword('');
    setIsPasswordValid(false);
  }, []);
  const handleConfirmPasswordChange = useCallback((newValue: string | undefined) => {
    setConfirmPassword(newValue ?? '');
  }, []);
  const handleConfirmPasswordValidation = useCallback(
    (newValue: string): boolean => {
      const isValid = newPassword.length > 0 && newValue.length > 0 && newValue === newPassword;
      setIsPasswordValid(isValid);
      return isValid;
    },
    [newPassword]
  );

  return (
    <Fragment>
      <Card isCollapsible defaultCollapsed title="Change password">
        <div className={styles.inputContainer}>
          <TextInput
            name="current-password"
            password
            value={currentPassword}
            onChange={handleCurrentPasswordChange}
            layout="horizontal"
            label="Current"
            autoComplete="off"
          />
          <TextInput
            name="new-password"
            password
            value={newPassword}
            onChange={handleNewPasswordChange}
            layout="horizontal"
            label="New"
            autoComplete="off"
          />
          <TextInput
            name="confirm-new-password"
            password
            value={confirmPassword}
            onChange={handleConfirmPasswordChange}
            layout="horizontal"
            label="Confirm"
            autoComplete="off"
            validate={handleConfirmPasswordValidation}
          />
        </div>
        <Button
          type="primary"
          loading={loading}
          onClick={handleChangePassword}
          disabled={
            !isPasswordValid ||
            currentPassword.length === 0 ||
            newPassword.length === 0 ||
            confirmPassword.length === 0
          }
        >
          {loading ? 'Changing…' : 'Change password'}
        </Button>
      </Card>
      {toast && (
        <Toast key={submitCount} message={toast.text} type={toast.type} onDismiss={handleDismiss} />
      )}
    </Fragment>
  );
};

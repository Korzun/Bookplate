import { Fragment, useCallback, useEffect, useState } from 'react';

import { Card, Toast } from '~/component';
import { Button, TextInput } from '~/control';
import { useChangeMyPassword } from '~/provider/user';

import { useStyle } from './style';

export const UserChangePassword = () => {
  const styles = useStyle();
  const [changeMyPassword, loading, okay, error, errorMessage] = useChangeMyPassword();
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isPasswordValid, setIsPasswordValid] = useState<boolean>(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [submitCount, setSubmitCount] = useState(0);
  const handleDismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (submitCount === 0) return;
    if (loading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToast(null);
      return;
    }
    if (error) {
      setToast({ text: errorMessage ?? 'Password change failed', type: 'error' });
      return;
    }
    if (okay) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsPasswordValid(false);
      setToast({ text: 'Password changed', type: 'success' });
    }
  }, [submitCount, loading, okay, error, errorMessage]);

  const handleChangePassword = useCallback(() => {
    setSubmitCount((count) => count + 1);
    changeMyPassword(currentPassword, newPassword);
  }, [changeMyPassword, currentPassword, newPassword]);

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

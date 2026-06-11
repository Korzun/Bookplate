import { useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button, TextInput } from '~/control';
import { useToast } from '~/provider/toast';
import { useChangeMyPassword } from '~/provider/user';

import { useStyle } from './style';

export const UserChangePassword = () => {
  const styles = useStyle();
  const [changeMyPassword, loading] = useChangeMyPassword();
  const showToast = useToast();
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isPasswordValid, setIsPasswordValid] = useState<boolean>(false);

  const handleChangePassword = useCallback(async () => {
    const changed = await changeMyPassword(currentPassword, newPassword);
    if (changed) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsPasswordValid(false);
      showToast('Password changed', 'success');
    } else {
      showToast('Password change failed', 'error');
    }
  }, [changeMyPassword, currentPassword, newPassword, showToast]);

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
  );
};

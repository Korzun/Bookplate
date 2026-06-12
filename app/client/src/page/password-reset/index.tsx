import { useCallback, useState } from 'react';

import { Card, Page } from '~/component';
import { Button, TextInput } from '~/control';
import { BooksIcon } from '~/icon';
import { useChangeMyPassword } from '~/provider/user';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

export const PasswordResetPage = () => {
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
    <Page type="minimal">
      <div className={styles.root}>
        <h1 className={styles.title}>
          <BooksIcon /> HASS-ODPS
        </h1>
        <Card className={styles.card}>
          <div className={styles.banner}>You must change your password before continuing.</div>
          <div className={styles.inputContainer}>
            <TextInput
              name="current-password"
              password
              value={currentPassword}
              onChange={handleCurrentPasswordChange}
              layout="horizontal"
              placeholder='Current Password'
              autoComplete="off"
            />
            <TextInput
              name="new-password"
              password
              value={newPassword}
              onChange={handleNewPasswordChange}
              layout="horizontal"
              placeholder='New Password'
              autoComplete="off"
            />
            <TextInput
              name="confirm-new-password"
              password
              value={confirmPassword}
              onChange={handleConfirmPasswordChange}
              layout="horizontal"
              placeholder='Confirm New Password'
              autoComplete="off"
              validate={handleConfirmPasswordValidation}
            />
          </div>
          <Button loading={loading} type="primary" onClick={handleChangePassword}>
            Change password
          </Button>
        </Card>
      </div>
    </Page>
  );
};

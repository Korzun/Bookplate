import { useActionState, useCallback, useState } from 'react';

import { Card, Page } from '~/component';
import { Button, TextInput } from '~/control';
import { BooksIcon } from '~/icon';
import { useLibraryName } from '~/provider/config';
import { useToast } from '~/provider/toast';
import { useChangeMyPassword } from '~/provider/user';

import { useStyle } from './style';

export const PasswordResetPage = () => {
  const styles = useStyle();
  const [changeMyPassword] = useChangeMyPassword();
  const showToast = useToast();
  const libraryName = useLibraryName();
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isPasswordValid, setIsPasswordValid] = useState<boolean>(false);

  const [, submitAction, isPending] = useActionState(async () => {
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
    return null;
  }, null);

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
          <BooksIcon /> {libraryName}
        </h1>
        <Card className={styles.card}>
          <div className={styles.banner}>You must change your password before continuing.</div>
          <form className={styles.form} action={submitAction}>
            <div className={styles.inputContainer}>
              <TextInput
                name="current-password"
                password
                value={currentPassword}
                onChange={handleCurrentPasswordChange}
                layout="horizontal"
                placeholder="Current Password"
                autoComplete="current-password"
              />
              <TextInput
                name="new-password"
                password
                value={newPassword}
                onChange={handleNewPasswordChange}
                layout="horizontal"
                placeholder="New Password"
                autoComplete="new-password"
              />
              <TextInput
                name="confirm-new-password"
                password
                value={confirmPassword}
                onChange={handleConfirmPasswordChange}
                layout="horizontal"
                placeholder="Confirm New Password"
                autoComplete="new-password"
                validate={handleConfirmPasswordValidation}
              />
            </div>
            <Button
              submit
              disabled={!currentPassword || !newPassword || !isPasswordValid}
              loading={isPending}
              type="primary"
              radius="card"
            >
              Change password
            </Button>
          </form>
        </Card>
      </div>
    </Page>
  );
};

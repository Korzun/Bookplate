import { Fragment, useActionState, useCallback, useState } from 'react';

import { Card, CardDivider } from '~/component';
import { Button, PasswordResultModal, TextInput } from '~/control';
import { useToast } from '~/provider/toast';
import { useRegisterUser } from '~/provider/user';

import { useStyle } from './style';

export const UserRegister = () => {
  const styles = useStyle();
  const [registerUser] = useRegisterUser();
  const showToast = useToast();
  const [username, setUsername] = useState<string>('');
  const [isUsernameValid, setIsUsernameValid] = useState<boolean>(false);
  const [result, setResult] = useState<{ username: string; password: string } | null>(null);

  const [, submitAction, isPending] = useActionState(async () => {
    const newPassword = await registerUser(username);
    if (newPassword === null) {
      showToast('Registration failed', 'error');
    } else {
      setResult({ username, password: newPassword });
      setUsername('');
      setIsUsernameValid(false);
    }
    return null;
  }, null);

  const handleUsernameChange = useCallback((newValue: string | undefined) => {
    setUsername(newValue ?? '');
  }, []);

  // TextInput only fires onChange when validate() passes, so a short username
  // never reaches `username` state; validate is also where we track the
  // enable/disable flag and drive the input's danger styling.
  const validateUsername = useCallback((newValue: string): boolean => {
    const valid = newValue.trim().length >= 6;
    setIsUsernameValid(valid);
    return valid;
  }, []);

  const handleDone = useCallback(() => {
    setResult(null);
  }, []);

  return (
    <Fragment>
      <Card title="Register a user">
        <form className={styles.form} action={submitAction}>
          <div className={styles.inputContainer}>
            <TextInput
              name="username"
              value={username}
              onChange={handleUsernameChange}
              validate={validateUsername}
              layout="horizontal"
              label="Username"
              autoComplete="off"
            />
          </div>
          <CardDivider />
          <Button
            className={styles.submit}
            type="primary"
            radius="card"
            submit
            loading={isPending}
            disabled={!isUsernameValid}
          >
            {isPending ? 'Registering…' : 'Register'}
          </Button>
        </form>
      </Card>
      <PasswordResultModal
        isOpen={result !== null}
        username={result?.username ?? ''}
        password={result?.password ?? null}
        onDone={handleDone}
      />
    </Fragment>
  );
};

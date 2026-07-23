import { Fragment, useActionState, useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button, PasswordResultModal, TextInput } from '~/control';
import { useToast } from '~/provider/toast';
import { useRegisterUser } from '~/provider/user';

import { useStyle } from './style';

export const UserRegister = () => {
  const styles = useStyle();
  const [registerUser] = useRegisterUser();
  const showToast = useToast();
  const [username, setUsername] = useState<string>('');
  const [result, setResult] = useState<{ username: string; password: string } | null>(null);

  const [, submitAction, isPending] = useActionState(async () => {
    const newPassword = await registerUser(username);
    if (newPassword === null) {
      showToast('Registration failed', 'error');
    } else {
      setResult({ username, password: newPassword });
      setUsername('');
    }
    return null;
  }, null);

  const handleUsernameChange = useCallback((newValue: string | undefined) => {
    setUsername(newValue ?? '');
  }, []);

  const handleDone = useCallback(() => {
    setResult(null);
  }, []);

  return (
    <Fragment>
      <Card title="Register new User">
        <form action={submitAction}>
          <div className={styles.inputContainer}>
            <TextInput
              name="username"
              value={username}
              onChange={handleUsernameChange}
              layout="horizontal"
              label="Username"
              autoComplete="off"
            />
          </div>
          <Button className={styles.submit} type="primary" radius="card" submit loading={isPending}>
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

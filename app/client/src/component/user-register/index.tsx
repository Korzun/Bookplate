import { Fragment, useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button, PasswordResultModal, TextInput } from '~/control';
import { useToast } from '~/provider/toast';
import { useRegisterUser } from '~/provider/user';

import { useStyle } from './style';

export const UserRegister = () => {
  const styles = useStyle();
  const [registerUser, loading] = useRegisterUser();
  const showToast = useToast();
  const [username, setUsername] = useState<string>('');
  const [result, setResult] = useState<{ username: string; password: string } | null>(null);

  const handleRegisterUser = useCallback(async () => {
    const newPassword = await registerUser(username);
    if (newPassword === null) {
      showToast('Registration failed', 'error');
    } else {
      setResult({ username, password: newPassword });
      setUsername('');
    }
  }, [registerUser, username, showToast]);

  const handleUsernameChange = useCallback((newValue: string | undefined) => {
    setUsername(newValue ?? '');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !loading) void handleRegisterUser();
    },
    [handleRegisterUser, loading]
  );

  const handleDone = useCallback(() => {
    setResult(null);
  }, []);

  return (
    <Fragment>
      <Card title="Register new User">
        <div className={styles.inputContainer}>
          <TextInput
            name="username"
            value={username}
            onChange={handleUsernameChange}
            layout="horizontal"
            label="Username"
            autoComplete="off"
            onKeyDown={handleKeyDown}
          />
        </div>
        <Button
          className={styles.submit}
          type="primary"
          radius="card"
          loading={loading}
          onClick={handleRegisterUser}
        >
          {loading ? 'Registering…' : 'Register'}
        </Button>
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

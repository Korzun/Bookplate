import { useCallback, useEffect, useState } from 'react';

import { Card, Toast } from '~/component';
import { Button, TextInput } from '~/control';
import { useRegisterUser } from '~/provider/user';

import { useStyle } from './style';

export const UserRegister = () => {
  const styles = useStyle();

  const [registerUser, loading, okay, error, errorMessage] = useRegisterUser();
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
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
      setToast({ text: errorMessage ?? 'Registration failed', type: 'error' });
      return;
    }
    if (okay) {
      setToast({ text: 'User registered', type: 'success' });
    }
  }, [submitCount, loading, okay, error, errorMessage]);

  const handleRegisterUser = useCallback(() => {
    setSubmitCount((c) => c + 1);
    registerUser(username, password);
  }, [registerUser, username, password]);

  const handleUsernameChange = useCallback(
    (newValue: string | undefined) => {
      setUsername(newValue ?? '');
    },
    [setUsername]
  );

  const handlePasswordChange = useCallback(
    (newValue: string | undefined) => {
      setPassword(newValue ?? '');
    },
    [setPassword]
  );

  return (
    <Card title="Register new User">
      <div className={styles.inputContainer}>
        <TextInput
          name="username"
          value={username}
          onChange={handleUsernameChange}
          layout="horizontal"
          label="Username"
          autoComplete="off"
        />
        <TextInput
          name="password"
          password
          value={password}
          onChange={handlePasswordChange}
          layout="horizontal"
          label="Password"
          autoComplete="off"
        />
      </div>
      <Button type="primary" loading={loading} onClick={handleRegisterUser}>
        {loading ? 'Registering…' : 'Register'}
      </Button>
      {toast && (
        <Toast key={submitCount} message={toast.text} type={toast.type} onDismiss={handleDismiss} />
      )}
    </Card>
  );
};

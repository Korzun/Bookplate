import { useCallback, useState } from 'react';

import { Card, Toast } from '~/component';
import { Button, TextInput } from '~/control';
import { useRegisterUser } from '~/provider/user';

import { useStyle } from './style';

export const UserRegister = () => {
  const styles = useStyle();

  const [registerUser, loading, okay, error, errorMessage] = useRegisterUser();
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [submitCount, setSubmitCount] = useState(0);
  const [dismissedCount, setDismissedCount] = useState(0);
  const handleDismiss = useCallback(() => setDismissedCount(submitCount), [submitCount]);

  const toast = (() => {
    if (submitCount === 0 || dismissedCount >= submitCount || loading) return null;
    if (error) return { text: errorMessage ?? 'Registration failed', type: 'error' as const };
    if (okay) return { text: 'User registered', type: 'success' as const };
    return null;
  })();

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

import { useCallback, useState } from 'react';

import { Card, Page, Toast } from '~/component';
import { Button, TextInput } from '~/control';
import { BooksIcon } from '~/icon';
import { useAuthRefresh } from '~/provider/auth';

import { useStyle } from './style';

export const LoginPage = () => {
  const styles = useStyle();
  const refetch = useAuthRefresh();

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>();
  const handleDismissError = useCallback(() => setError(undefined), []);

  const [username, setUsername] = useState<string | undefined>();
  const handleUsernameChange = useCallback((newUsername: string | undefined) => {
    setUsername(newUsername);
  }, []);

  const [password, setPassword] = useState<string | undefined>();
  const handlePasswordChange = useCallback((newPassword: string | undefined) => {
    setPassword(newPassword);
  }, []);

  const handleLogin = useCallback(async () => {
    try {
      setLoading(true);
      setError(undefined);
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password }),
      });
      if (response.ok) {
        await refetch();
      } else {
        setError('Invalid credentials');
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }, [username, password, refetch]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter') {
        event.stopPropagation();
        handleLogin();
      }
    },
    [handleLogin]
  );

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <Card className={styles.card}>
          <h1 className={styles.title}>
            <BooksIcon /> HASS-ODPS
          </h1>
          <div className={styles.inputContainer}>
            <TextInput
              placeholder="Username"
              name="username"
              onChange={handleUsernameChange}
              value={username}
            />
            <TextInput
              placeholder="Password"
              name="password"
              onChange={handlePasswordChange}
              onKeyDown={handleKeyDown}
              password
              value={password}
            />
          </div>
          <Button loading={loading} type="primary" onClick={handleLogin}>
            Sign In
          </Button>
        </Card>
      </div>
      {error && <Toast message={error} type="error" onDismiss={handleDismissError} />}
    </Page>
  );
};

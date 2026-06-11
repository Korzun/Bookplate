import { useCallback, useState } from 'react';

import { Card, Page } from '~/component';
import { Button, TextInput } from '~/control';
import { BooksIcon } from '~/icon';
import { extractAccessToken, setToken } from '~/lib/token';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

export const LoginPage = () => {
  const styles = useStyle();
  const showToast = useToast();

  const [loading, setLoading] = useState<boolean>(false);
  const [username, setUsername] = useState<string | undefined>();
  const [password, setPassword] = useState<string | undefined>();

  const handleUsernameChange = useCallback((newUsername: string | undefined) => {
    setUsername(newUsername);
  }, []);

  const handlePasswordChange = useCallback((newPassword: string | undefined) => {
    setPassword(newPassword);
  }, []);

  const handleLogin = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: username ?? '', password: password ?? '' }),
      });
      if (response.ok) {
        const accessToken = extractAccessToken(await response.json());
        if (accessToken) {
          setToken(accessToken);
        } else {
          showToast('Unexpected response from server', 'error');
        }
      } else {
        showToast('Invalid credentials', 'error');
      }
    } catch {
      showToast('Network error — please try again', 'error');
    } finally {
      setLoading(false);
    }
  }, [username, password, showToast]);

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
        <h1 className={styles.title}>
          <BooksIcon /> HASS-ODPS
        </h1>
        <Card className={styles.card}>
          <div className={styles.inputContainer}>
            <TextInput
              placeholder="Username"
              name="username"
              autoCapitalize="none"
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
    </Page>
  );
};

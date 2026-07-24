import { useActionState, useState } from 'react';

import { BrandLockup, Card, Page } from '~/component';
import { Button, TextInput } from '~/control';
import { extractAccessToken, setToken } from '~/lib/token';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

export const LoginPage = () => {
  const styles = useStyle();
  const showToast = useToast();

  const [username, setUsername] = useState<string | undefined>();
  const [password, setPassword] = useState<string | undefined>();

  const [, submitAction, isPending] = useActionState(async () => {
    try {
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
    }
    return null;
  }, null);

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <BrandLockup />
        <Card className={styles.card}>
          <form className={styles.form} action={submitAction}>
            <div className={styles.inputContainer}>
              <TextInput
                placeholder="Username"
                name="username"
                autoCapitalize="none"
                onChange={setUsername}
                value={username}
              />
              <TextInput
                placeholder="Password"
                name="password"
                onChange={setPassword}
                password
                value={password}
              />
            </div>
            <Button submit loading={isPending} type="primary" radius="card">
              Sign In
            </Button>
          </form>
        </Card>
      </div>
    </Page>
  );
};

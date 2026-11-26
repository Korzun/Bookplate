import { useActionState, useState } from 'react';
import { useNavigate } from 'react-router';

import { BrandLockup, Card, Page } from '~/component';
import { Button, TextInput } from '~/control';
import { login } from '~/lib/login';
import { useEmailEnabled } from '~/provider/config';
import { useToast } from '~/provider/toast';
import { path } from '~/router';

import { useStyle } from './style';

export const LoginPage = () => {
  const styles = useStyle();
  const navigate = useNavigate();
  const showToast = useToast();
  const emailEnabled = useEmailEnabled();

  const [username, setUsername] = useState<string | undefined>();
  const [password, setPassword] = useState<string | undefined>();

  const [, submitAction, isPending] = useActionState(async () => {
    const result = await login(username ?? '', password ?? '');
    switch (result.status) {
      case 'ok':
        // `login` stored the token; AuthProvider and the route guards take it
        // from here.
        break;
      case 'malformed':
        showToast('Unexpected response from server', 'error');
        break;
      case 'rate-limited':
        // A 429 is NOT a credentials failure. It is the 10/minute IP limiter,
        // the 5-failure lockout, or "server busy" when every password check
        // slot is taken (routes/ui.ts); the server's text says which. The
        // seconds wording is only for a body without one.
        showToast(
          result.message ??
            (result.retryAfterSeconds !== null
              ? `Too many attempts — try again in ${result.retryAfterSeconds} seconds`
              : 'Too many attempts — please wait a moment and try again'),
          'error'
        );
        break;
      case 'rejected':
        showToast('Invalid credentials', 'error');
        break;
      case 'network-error':
        showToast('Network error — please try again', 'error');
        break;
    }
    return null;
  }, null);

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <BrandLockup />
        {/* The stack shrink-wraps to its widest child — the card, itself sized
            by the fields' min-width — so the button below stretches to exactly
            the card's width without that width being restated here. */}
        <div className={styles.stack}>
          <Card>
            <form className={styles.form} action={submitAction}>
              <div className={styles.inputContainer}>
                <TextInput
                  placeholder={emailEnabled ? 'Username or email' : 'Username'}
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
          {/* On the page rather than in a card, so it takes the page radius —
              the Button default, hence no `radius` prop. */}
          {emailEnabled ? (
            <Button type="default" onClick={() => void navigate(path.forgotPassword())}>
              Forgot password?
            </Button>
          ) : null}
        </div>
      </div>
    </Page>
  );
};

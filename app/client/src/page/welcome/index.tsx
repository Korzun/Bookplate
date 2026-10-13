import { useActionState, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { BrandLockup, Card, Page } from '~/component';
import { Button, TextInput } from '~/control';
import { extractAccessToken, setToken } from '~/lib/token';
import { path } from '~/router';

import { useStyle } from './style';

/**
 * Where a welcome email's link lands: a newly registered account chooses its
 * first password with the code it was sent. `POST /api/onboard` also confirms
 * the address and signs the user in — storing the returned token is enough for
 * `UnprotectedRoute` to send them on to the library, exactly as the login page
 * relies on.
 *
 * Both fields are prefilled from the link but editable: on an install with no
 * `publicUrl` the email carries only a code, and the user arrives here from the
 * login page's "Set up a new account" button.
 */
export const WelcomePage = () => {
  const styles = useStyle();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState<string>(searchParams.get('email') ?? '');
  const [code, setCode] = useState<string>(searchParams.get('code') ?? '');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Client-side only, and NOT a security boundary: the server enforces the
  // 8-character floor independently.
  const canSubmit =
    email !== '' && code !== '' && newPassword.length >= 8 && newPassword === confirmPassword;

  const [, submitAction, isPending] = useActionState(async () => {
    setError(null);
    if (!canSubmit) {
      setError(
        newPassword !== confirmPassword
          ? 'Those passwords do not match'
          : 'Fill in every field; the password must be at least 8 characters'
      );
      return null;
    }
    try {
      const response = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword }),
      });
      if (response.ok) {
        const accessToken = extractAccessToken(await response.json());
        if (accessToken) {
          setToken(accessToken);
        } else {
          setError('Unexpected response from server');
        }
        return null;
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        setError(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? `Too many attempts — try again in ${retryAfter} seconds`
            : 'Too many attempts — please wait a moment and try again'
        );
        return null;
      }
      if (response.status === 404) {
        setError('Email is not configured on this server. Ask the administrator to set it up.');
        return null;
      }
      // Not forgot-password: that flow needs a verified address, which this
      // account does not have until onboarding succeeds.
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(
        `${body.error ?? 'That link is not valid or has expired.'} Ask your library admin to register you again.`
      );
    } catch {
      setError('Network error — please try again');
    }
    return null;
  }, null);

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <BrandLockup />
        <div className={styles.stack}>
          <Card>
            <div className={styles.content}>
              <form className={styles.form} action={submitAction}>
                <TextInput
                  placeholder="Email address"
                  name="email"
                  autoCapitalize="none"
                  onChange={(value) => setEmail(value ?? '')}
                  value={email}
                />
                <TextInput
                  placeholder="Welcome code"
                  name="code"
                  autoCapitalize="characters"
                  onChange={(value) => setCode(value ?? '')}
                  value={code}
                />
                <TextInput
                  placeholder="New password"
                  name="newPassword"
                  password
                  onChange={(value) => setNewPassword(value ?? '')}
                  value={newPassword}
                />
                <TextInput
                  placeholder="Confirm new password"
                  name="confirmPassword"
                  password
                  onChange={(value) => setConfirmPassword(value ?? '')}
                  value={confirmPassword}
                />
                <Button submit loading={isPending} type="primary" radius="card">
                  Set password
                </Button>
                {error === null ? null : <p className={styles.error}>{error}</p>}
              </form>
            </div>
          </Card>
          <Button type="default" onClick={() => void navigate(path.login())}>
            Back to sign in
          </Button>
        </div>
      </div>
    </Page>
  );
};

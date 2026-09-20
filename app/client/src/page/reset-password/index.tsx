import { useActionState, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { BrandLockup, Card, Page } from '~/component';
import { Button, TextInput } from '~/control';
import { path } from '~/router';

import { useStyle } from './style';

export const ResetPasswordPage = () => {
  const styles = useStyle();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState<string>('');
  // Prefilled when the user followed the link from their inbox.
  const [code, setCode] = useState<string>(searchParams.get('code') ?? '');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Client-side only, and NOT a security boundary: the server enforces the
  // 8-character floor independently. This avoids a round-trip and gives the
  // mismatch its own message instead of the server's single generic one.
  const canSubmit =
    email !== '' && code !== '' && newPassword.length >= 8 && newPassword === confirmPassword;

  const [, submitAction, isPending] = useActionState(async () => {
    setError(null);
    if (!canSubmit) {
      setError(
        newPassword !== confirmPassword
          ? 'Those passwords do not match'
          : 'Fill in every field; the new password must be at least 8 characters'
      );
      return null;
    }
    try {
      const response = await fetch('/api/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword }),
      });
      if (response.status === 204) {
        setDone(true);
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
        // Mail is unconfigured on this install — same wording as the GraphQL
        // side's EmailNotConfiguredError, and as the sibling forgot-password
        // screen. Without this, a 404 fell into the generic branch below and
        // misattributed a server misconfiguration to the user's own code.
        setError('Email is not configured on this server. Ask the administrator to set it up.');
        return null;
      }
      // The server speaks ONE message for every rejected code — wrong, expired,
      // already used, unknown address. Show it verbatim rather than guessing at a
      // more specific cause the response deliberately does not carry.
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'That reset code is not valid or has expired.');
    } catch {
      setError('Network error — please try again');
    }
    return null;
  }, null);

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <BrandLockup />
        <Card className={styles.card}>
          {done ? (
            <>
              <p className={styles.lead}>Your password reset — sign in with your new password.</p>
              <Link className={styles.link} to={path.login()}>
                Go to sign in
              </Link>
            </>
          ) : (
            <form className={styles.form} action={submitAction}>
              <p className={styles.lead}>
                The administrator account&rsquo;s password is set in the add-on configuration, not
                here.
              </p>
              <TextInput
                placeholder="Email address"
                name="email"
                autoCapitalize="none"
                onChange={(value) => setEmail(value ?? '')}
                value={email}
              />
              <TextInput
                placeholder="Reset code"
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
                Reset password
              </Button>
              {error === null ? null : <p className={styles.error}>{error}</p>}
              <Link className={styles.link} to={path.login()}>
                Back to sign in
              </Link>
            </form>
          )}
        </Card>
      </div>
    </Page>
  );
};

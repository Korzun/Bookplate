import { useActionState, useState } from 'react';
import { Link } from 'react-router';

import { BrandLockup, Card, Page } from '~/component';
import { Button, TextInput } from '~/control';
import { path } from '~/router';

import { useStyle } from './style';

/**
 * Deliberately says the same thing for every outcome except a rate limit: the
 * server answers 204 for an unknown address, an unverified one, and the admin
 * alike, specifically so this screen cannot be used to discover whether an
 * address has an account. Inventing a distinction here would undo that.
 */
export const ForgotPasswordPage = () => {
  const styles = useStyle();
  const [email, setEmail] = useState<string>('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [, submitAction, isPending] = useActionState(async () => {
    setError(null);
    try {
      const response = await fetch('/api/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
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
        // Mail is unconfigured on this install — a GLOBAL condition
        // (requireMail in routes/password.ts), not something that depends on
        // the submitted address, so stating it plainly leaks nothing the
        // already-public emailEnabled flag doesn't. Same wording as the
        // GraphQL side's EmailNotConfiguredError, so both paths agree.
        setError('Email is not configured on this server. Ask the administrator to set it up.');
        return null;
      }
      if (response.status !== 204) {
        // Anything else (a 5xx, a misconfigured proxy, ...) is NOT collapsed
        // into the success message either: this endpoint is documented to
        // answer only 204/429/404, so an unexpected status means the request
        // did not actually complete, and telling the user a code "is on its
        // way" would be exactly the same kind of false positive as the 404
        // case above, just from a different cause.
        setError('Something went wrong — please try again');
        return null;
      }
      setSent(true);
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
          {sent ? (
            <p className={styles.lead}>
              If that address has an account, a reset code is on its way.
            </p>
          ) : (
            <form className={styles.form} action={submitAction}>
              <p className={styles.lead}>
                Enter your email address and we&rsquo;ll send you a reset code.
              </p>
              <TextInput
                placeholder="Email address"
                name="email"
                autoCapitalize="none"
                onChange={(value) => setEmail(value ?? '')}
                value={email}
              />
              <Button submit loading={isPending} type="primary" radius="card">
                Send reset code
              </Button>
              {error === null ? null : <p className={styles.error}>{error}</p>}
            </form>
          )}
          {/* In BOTH states: a user who already has a code should not have to
              submit the form to reach the next screen. */}
          <Link className={styles.link} to={path.resetPasswordByEmail()}>
            I have a code
          </Link>
          <Link className={styles.link} to={path.login()}>
            Back to sign in
          </Link>
        </Card>
      </div>
    </Page>
  );
};

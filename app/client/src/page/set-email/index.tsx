import { useMutation } from '@apollo/client/react';
import { useActionState, useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';

import { BrandLockup, Card, Page } from '~/component';
import { Button, TextInput } from '~/control';
import type { ViewerConfirmEmailMutation, ViewerSetEmailMutation } from '~/gql/graphql';
import {
  ViewerConfirmEmailDocument,
  ViewerResendEmailVerificationDocument,
  ViewerSetEmailDocument,
} from '~/graphql/email';
import { refreshAccessToken } from '~/lib/api-fetch';
import { unwrapResult } from '~/provider/apollo';
import { useToast } from '~/provider/toast';
import { path } from '~/router';

import { useStyle } from './style';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type ViewerSetEmailPayload = Extract<
  NonNullable<ViewerSetEmailMutation['viewerSetEmail']>,
  { __typename: 'ViewerSetEmailPayload' }
>;
type ViewerConfirmEmailPayload = Extract<
  NonNullable<ViewerConfirmEmailMutation['viewerConfirmEmail']>,
  { __typename: 'ViewerConfirmEmailPayload' }
>;

/**
 * Where `ProtectedRoute` sends every `mustSetEmail` viewer. Like the forced
 * password-change page (`page/password-reset`) it must render and submit
 * with NO prior GraphQL query — every `Query` field is gated on
 * `authenticated`, which is false for a gated viewer — so this component
 * has no `useQuery` of its own.
 *
 * It differs from that page in one important way: confirming here does NOT
 * log the caller out. `userChangePassword` revokes every refresh token as a
 * side effect and therefore has to end the session; setting an address
 * revokes nothing, so on a successful confirm this page mints a fresh
 * access token via `refreshAccessToken()` (`POST /api/auth/refresh` rebuilds
 * claims from current state) and navigates home — the gate lifts
 * immediately instead of after the 15-minute token TTL, and the caller stays
 * signed in throughout.
 */
export const SetEmailPage = () => {
  const styles = useStyle();
  const showToast = useToast();
  const [searchParams] = useSearchParams();
  const [runSetEmail] = useMutation(ViewerSetEmailDocument);
  const [runConfirm] = useMutation(ViewerConfirmEmailDocument);
  const [runResend] = useMutation(ViewerResendEmailVerificationDocument);

  const [email, setEmail] = useState<string>('');
  // A code in the URL means the viewer followed the link from their inbox, so
  // the address is already saved and only the code stage is left.
  const [code, setCode] = useState<string>(searchParams.get('code') ?? '');
  const [stage, setStage] = useState<'address' | 'code'>(
    searchParams.get('code') === null ? 'address' : 'code'
  );

  const handleEmailChange = useCallback((newValue: string | undefined) => {
    setEmail(newValue ?? '');
  }, []);
  const handleCodeChange = useCallback((newValue: string | undefined) => {
    setCode(newValue ?? '');
  }, []);

  const [, submitAddress, isSaving] = useActionState(async () => {
    const { data } = await runSetEmail({ variables: { input: { email } } });
    const result = unwrapResult<ViewerSetEmailPayload>(
      data?.viewerSetEmail,
      'ViewerSetEmailPayload'
    );
    if (result.status === 'ok') {
      showToast(
        result.payload.delivered
          ? 'Check your inbox for the confirmation code'
          : 'Address saved, but the email could not be sent — try resending',
        result.payload.delivered ? 'success' : 'error'
      );
      setStage('code');
      return null;
    }
    showToast(result.status === 'error' ? result.message : 'Could not save that address', 'error');
    return null;
  }, null);

  const [, submitCode, isConfirming] = useActionState(async () => {
    const { data } = await runConfirm({ variables: { input: { code } } });
    const result = unwrapResult<ViewerConfirmEmailPayload>(
      data?.viewerConfirmEmail,
      'ViewerConfirmEmailPayload'
    );
    if (result.status === 'ok') {
      showToast('Email confirmed', 'success');
      // The confirmation itself changed nothing about the caller's session —
      // only the mustSetEmail claim baked into the current access token is
      // stale. Refresh to rebuild it rather than logging out.
      await refreshAccessToken();
      window.location.assign(path.home());
      return null;
    }
    showToast(result.status === 'error' ? result.message : 'Could not confirm that code', 'error');
    return null;
  }, null);

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <BrandLockup />
        <Card className={styles.card}>
          {stage === 'address' ? (
            <form className={styles.form} action={submitAddress}>
              <p className={styles.lead}>
                Add an email address to your account. We&rsquo;ll send a code to confirm it.
              </p>
              <TextInput
                placeholder="Email address"
                name="email"
                autoCapitalize="none"
                onChange={handleEmailChange}
                value={email}
              />
              <Button submit loading={isSaving} type="primary" radius="card">
                Send confirmation code
              </Button>
            </form>
          ) : (
            <form className={styles.form} action={submitCode}>
              <p className={styles.lead}>
                Enter the code we sent to {email === '' ? 'your email address' : email}.
              </p>
              <TextInput
                placeholder="Confirmation code"
                name="code"
                autoCapitalize="characters"
                onChange={handleCodeChange}
                value={code}
              />
              <Button submit loading={isConfirming} type="primary" radius="card">
                Confirm
              </Button>
              <Button type="text" onClick={() => void runResend()}>
                Resend code
              </Button>
              <Button type="text" onClick={() => setStage('address')}>
                Use a different address
              </Button>
            </form>
          )}
        </Card>
      </div>
    </Page>
  );
};

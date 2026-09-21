import { useApolloClient, useMutation } from '@apollo/client/react';
import { Fragment, useCallback, useId, useState } from 'react';

import { Card } from '~/component';
import { Button, TextInput } from '~/control';
import type {
  ViewerConfirmEmailMutation,
  ViewerResendEmailVerificationMutation,
  ViewerSetEmailMutation,
} from '~/gql/graphql';
import {
  ViewerConfirmEmailDocument,
  ViewerResendEmailVerificationDocument,
  ViewerSetEmailDocument,
} from '~/graphql/email';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { unwrapResult } from '~/provider/apollo';
import { useEmailEnabled } from '~/provider/config';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated — same pattern `page/set-email` and
// `component/sync-password` already use.
type ViewerSetEmailPayload = Extract<
  NonNullable<ViewerSetEmailMutation['viewerSetEmail']>,
  { __typename: 'ViewerSetEmailPayload' }
>;
type ViewerConfirmEmailPayload = Extract<
  NonNullable<ViewerConfirmEmailMutation['viewerConfirmEmail']>,
  { __typename: 'ViewerConfirmEmailPayload' }
>;
type ViewerResendEmailVerificationPayload = Extract<
  NonNullable<ViewerResendEmailVerificationMutation['viewerResendEmailVerification']>,
  { __typename: 'ViewerResendEmailVerificationPayload' }
>;

export type EmailSettingProps = {
  email: string | null;
  emailVerifiedAt: Date | null;
};

/**
 * The settings-page card for the viewer's own address — reuses Task 14's
 * three mutations (`graphql/email.ts`) rather than declaring new documents,
 * per that file's own doc comment on why a second copy would drift and
 * defeat Apollo's normalized cache.
 *
 * `email`/`emailVerifiedAt` are handed down as props (`page/user` reads them
 * off `ViewerBootstrapDocument`) rather than fetched here directly — this
 * component's own job is the three mutations and the state machine around
 * them, not the read.
 *
 * A successful `setEmail`/`confirmEmail` is reflected TWICE: immediately, via
 * local override state (so the badge updates without waiting on a round
 * trip — the same `newPassword ?? syncData?.viewer.syncPassword` pattern
 * `component/sync-password` already uses), and durably, via
 * `client.refetchQueries({ include: [ViewerBootstrapDocument] })` so the
 * badge eventually reflects real server state rather than local optimism.
 * `include` only refetches ACTIVE queries, so this is a no-op in isolation
 * (e.g. this component's own tests, which mount no `ViewerBootstrapDocument`
 * reader) and a real refetch wherever the app actually has one mounted
 * (`component/sync-password`, `component/nav` via `useCurrentLibraryId`).
 */
export const EmailSetting = ({ email, emailVerifiedAt }: EmailSettingProps) => {
  const emailEnabled = useEmailEnabled();
  const styles = useStyle();
  // Unique id ties the footer-slot submit button to this card's form by
  // construction, robust against any future co-mounting.
  const formId = useId();
  const client = useApolloClient();
  const showToast = useToast();

  const [runSetEmail, { loading: saving }] = useMutation(ViewerSetEmailDocument);
  const [runConfirm, { loading: confirming }] = useMutation(ViewerConfirmEmailDocument);
  const [runResend, { loading: resending }] = useMutation(ViewerResendEmailVerificationDocument);

  // Local overrides, applied on top of the props once a mutation succeeds —
  // `undefined` means "no override, use the prop".
  const [emailOverride, setEmailOverride] = useState<string | undefined>(undefined);
  const [verifiedOverride, setVerifiedOverride] = useState<Date | null | undefined>(undefined);

  const displayEmail = emailOverride ?? email;
  const displayVerifiedAt = verifiedOverride !== undefined ? verifiedOverride : emailVerifiedAt;
  const isConfirmed = displayVerifiedAt !== null;

  const [isEditing, setIsEditing] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');

  const refetchViewer = useCallback(
    () => client.refetchQueries({ include: [ViewerBootstrapDocument] }),
    [client]
  );

  const handleChangeClick = useCallback(() => {
    setPendingEmail(displayEmail ?? '');
    setIsEditing(true);
  }, [displayEmail]);

  const handleCancelEdit = useCallback(() => setIsEditing(false), []);

  const handlePendingEmailChange = useCallback((newValue: string | undefined) => {
    setPendingEmail(newValue ?? '');
  }, []);
  const handleCodeChange = useCallback((newValue: string | undefined) => {
    setCode(newValue ?? '');
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const { data } = await runSetEmail({ variables: { input: { email: pendingEmail } } });
      const result = unwrapResult<ViewerSetEmailPayload>(
        data?.viewerSetEmail,
        'ViewerSetEmailPayload'
      );
      if (result.status !== 'ok') {
        showToast(
          result.status === 'error' ? result.message : 'Could not save that address',
          'error'
        );
        return;
      }

      setEmailOverride(result.payload.email);
      setVerifiedOverride(null);
      setIsEditing(false);
      setCodeSent(false);
      setCode('');
      showToast(
        result.payload.delivered
          ? 'Check your inbox for the confirmation code'
          : 'Address saved, but the email could not be sent — try resending',
        result.payload.delivered ? 'success' : 'error'
      );
      await refetchViewer();
    } catch {
      showToast('Could not save that address', 'error');
    }
  }, [runSetEmail, pendingEmail, showToast, refetchViewer]);

  const handleResend = useCallback(async () => {
    try {
      const { data } = await runResend();
      const result = unwrapResult<ViewerResendEmailVerificationPayload>(
        data?.viewerResendEmailVerification,
        'ViewerResendEmailVerificationPayload'
      );
      if (result.status !== 'ok') {
        showToast(
          result.status === 'error' ? result.message : 'Could not resend the code',
          'error'
        );
        return;
      }

      setCodeSent(true);
      showToast(
        result.payload.delivered
          ? 'Check your inbox for the confirmation code'
          : 'Could not send the email — try again shortly',
        result.payload.delivered ? 'success' : 'error'
      );
    } catch {
      showToast('Could not resend the code', 'error');
    }
  }, [runResend, showToast]);

  const handleConfirm = useCallback(async () => {
    try {
      const { data } = await runConfirm({ variables: { input: { code } } });
      const result = unwrapResult<ViewerConfirmEmailPayload>(
        data?.viewerConfirmEmail,
        'ViewerConfirmEmailPayload'
      );
      if (result.status !== 'ok') {
        showToast(
          result.status === 'error' ? result.message : 'Could not confirm that code',
          'error'
        );
        return;
      }

      setVerifiedOverride(new Date());
      setCodeSent(false);
      setCode('');
      showToast('Email confirmed', 'success');
      await refetchViewer();
    } catch {
      showToast('Could not confirm that code', 'error');
    }
  }, [runConfirm, code, showToast, refetchViewer]);

  // Rendering nothing rather than a disabled section: on an install without mail
  // an email address does nothing at all, and a greyed-out control invites the
  // user to ask why.
  if (!emailEnabled) return null;

  const changeAction = [
    <Button key="change" type="link" onClick={handleChangeClick}>
      Change
    </Button>,
  ];

  // Matches `component/user-change-password`: the submit button lives in the
  // card footer, tied back to the form by a generated id rather than by DOM
  // nesting, so the two settings cards read the same way.
  const editFooter = (
    <Fragment>
      <Button type="text" disabled={saving} onClick={handleCancelEdit}>
        Cancel
      </Button>
      <Button
        submit
        form={formId}
        type="primary"
        loading={saving}
        radius="card"
        disabled={pendingEmail.trim().length === 0}
      >
        Save
      </Button>
    </Fragment>
  );

  return (
    <Card
      title="Email address"
      headerAction={isEditing ? undefined : changeAction}
      footer={isEditing ? editFooter : undefined}
    >
      {isEditing ? (
        <form id={formId} action={handleSave}>
          <div className={styles.inputContainer}>
            <TextInput
              name="email"
              autoCapitalize="none"
              value={pendingEmail}
              onChange={handlePendingEmailChange}
              layout="horizontal"
              label="Address"
              autoComplete="off"
            />
          </div>
        </form>
      ) : (
        <Fragment>
          <div className={styles.pill}>
            <span className={styles.address}>{displayEmail ?? '—'}</span>
            {isConfirmed ? (
              <span className={styles.badgeConfirmed}>Confirmed</span>
            ) : (
              <Fragment>
                <span className={styles.badgeUnconfirmed}>Not confirmed</span>
                {!codeSent && (
                  <Button
                    type="default"
                    loading={resending}
                    onClick={() => void handleResend()}
                    radius="card"
                  >
                    Resend code
                  </Button>
                )}
              </Fragment>
            )}
          </div>
          {!isConfirmed && codeSent && (
            <div className={styles.codeRow}>
              <TextInput
                placeholder="Code"
                name="code"
                autoCapitalize="characters"
                value={code}
                onChange={handleCodeChange}
              />
              <Button
                type="primary"
                loading={confirming}
                onClick={() => void handleConfirm()}
                radius="card"
              >
                Confirm
              </Button>
              <Button type="text" disabled={confirming} onClick={() => void handleResend()}>
                Resend
              </Button>
            </div>
          )}
        </Fragment>
      )}
    </Card>
  );
};

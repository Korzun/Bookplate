import { useMutation } from '@apollo/client/react';
import { useActionState, useCallback, useState } from 'react';

import { Card, Page } from '~/component';
import { Button, TextInput } from '~/control';
import type { UserChangePasswordMutation } from '~/gql/graphql';
import { UserChangePasswordDocument } from '~/graphql/user';
import { BooksIcon } from '~/icon';
import { logout as performLogout } from '~/lib/logout';
import { unwrapResult } from '~/provider/apollo';
import { useLibraryName } from '~/provider/config';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type UserChangePasswordPayload = Extract<
  NonNullable<UserChangePasswordMutation['userChangePassword']>,
  { __typename: 'UserChangePasswordPayload' }
>;

/**
 * `useChangeMyPassword` is inlined directly here rather than kept as a
 * `provider/user` hook — this page and `component/user-change-password` are
 * its only two callers, each inlining its own call. This is the page
 * `ProtectedRoute` sends every `mustChangePassword` viewer to, and it must
 * render and submit with no prior GraphQL query of any kind: every `Query`
 * field is gated on `authenticated`, which is false for a forced-reset
 * viewer — this component intentionally has no `useQuery` of its own.
 *
 * **The silent-logout contract.** `userChangePassword` revokes every one of
 * the caller's refresh tokens as its own side effect, and a GraphQL context
 * has no `Response` to reissue auth cookies on even if it wanted to — so a
 * successful call here must never "continue the session": it logs the
 * caller out and sends them to `/login`, unconditionally, via the same
 * shared best-effort `logout()` helper (`~/lib/logout`) the explicit "log
 * out" button's hook delegates to.
 */
export const PasswordResetPage = () => {
  const styles = useStyle();
  const [runChangePassword, { loading: isPending }] = useMutation(UserChangePasswordDocument);
  const showToast = useToast();
  const libraryName = useLibraryName();
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isPasswordValid, setIsPasswordValid] = useState<boolean>(false);

  const [, submitAction] = useActionState(async () => {
    try {
      const { data } = await runChangePassword({
        variables: { input: { currentPassword, newPassword } },
      });

      const result = unwrapResult<UserChangePasswordPayload>(
        data?.userChangePassword,
        'UserChangePasswordPayload'
      );
      if (result.status === 'missing') {
        showToast('Password change failed', 'error');
        return null;
      }
      if (result.status === 'error') {
        showToast(result.message, 'error');
        return null;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsPasswordValid(false);
      showToast('Password changed', 'success');

      // Same best-effort teardown as the logout button, via the one shared
      // helper — the password has already changed by this point, so the
      // session must end whether or not the cookie clear succeeds.
      await performLogout();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Password change failed', 'error');
    }
    return null;
  }, null);

  const handleCurrentPasswordChange = useCallback((newValue: string | undefined) => {
    setCurrentPassword(newValue ?? '');
  }, []);
  const handleNewPasswordChange = useCallback((newValue: string | undefined) => {
    setNewPassword(newValue ?? '');
    setConfirmPassword('');
    setIsPasswordValid(false);
  }, []);
  const handleConfirmPasswordChange = useCallback((newValue: string | undefined) => {
    setConfirmPassword(newValue ?? '');
  }, []);
  const handleConfirmPasswordValidation = useCallback(
    (newValue: string): boolean => {
      const isValid = newPassword.length > 0 && newValue.length > 0 && newValue === newPassword;
      setIsPasswordValid(isValid);
      return isValid;
    },
    [newPassword]
  );

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <h1 className={styles.title}>
          <BooksIcon /> {libraryName}
        </h1>
        <Card className={styles.card}>
          <div className={styles.banner}>You must change your password before continuing.</div>
          <form className={styles.form} action={submitAction}>
            <div className={styles.inputContainer}>
              <TextInput
                name="current-password"
                password
                value={currentPassword}
                onChange={handleCurrentPasswordChange}
                layout="horizontal"
                placeholder="Current Password"
                autoComplete="current-password"
              />
              <TextInput
                name="new-password"
                password
                value={newPassword}
                onChange={handleNewPasswordChange}
                layout="horizontal"
                placeholder="New Password"
                autoComplete="new-password"
              />
              <TextInput
                name="confirm-new-password"
                password
                value={confirmPassword}
                onChange={handleConfirmPasswordChange}
                layout="horizontal"
                placeholder="Confirm New Password"
                autoComplete="new-password"
                validate={handleConfirmPasswordValidation}
              />
            </div>
            <Button
              submit
              disabled={!currentPassword || !newPassword || !isPasswordValid}
              loading={isPending}
              type="primary"
              radius="card"
            >
              Change password
            </Button>
          </form>
        </Card>
      </div>
    </Page>
  );
};

import { useMutation } from '@apollo/client/react';
import { useActionState, useCallback, useId, useState } from 'react';

import { Card } from '~/component';
import { Button, TextInput } from '~/control';
import type { UserChangePasswordMutation } from '~/gql/graphql';
import { UserChangePasswordDocument } from '~/graphql/user';
import { logout as performLogout } from '~/lib/logout';
import { unwrapResult } from '~/provider/apollo';
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
 * `provider/user` hook — this form and `page/password-reset` are its only
 * two callers, and each inlines its own call (mirroring how the two files
 * already duplicate the rest of this form's shape independently) rather
 * than sharing a barrel hook.
 *
 * **The silent-logout contract.** `userChangePassword` revokes every one of
 * the caller's refresh tokens as its own side effect, and a GraphQL context
 * has no `Response` to reissue auth cookies on even if it wanted to — so a
 * successful call here must never "continue the session": it logs the
 * caller out and sends them to `/login`, unconditionally, via the same
 * shared best-effort `logout()` helper (`~/lib/logout`) the explicit "log
 * out" button's hook delegates to.
 */
export const UserChangePassword = () => {
  const styles = useStyle();
  // Unique id ties the footer-slot submit button to this form by construction,
  // robust against any future co-mounting.
  const formId = useId();
  const [runChangePassword, { loading: isPending }] = useMutation(UserChangePasswordDocument);
  const showToast = useToast();
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
    <Card
      title="Change password"
      footer={
        <Button
          submit
          form={formId}
          type="primary"
          loading={isPending}
          radius="card"
          disabled={
            !isPasswordValid ||
            currentPassword.length === 0 ||
            newPassword.length === 0 ||
            confirmPassword.length === 0
          }
        >
          {isPending ? 'Changing…' : 'Change password'}
        </Button>
      }
    >
      <form id={formId} action={submitAction}>
        <div className={styles.inputContainer}>
          <TextInput
            name="current-password"
            password
            value={currentPassword}
            onChange={handleCurrentPasswordChange}
            layout="horizontal"
            label="Current"
            autoComplete="off"
          />
          <TextInput
            name="new-password"
            password
            value={newPassword}
            onChange={handleNewPasswordChange}
            layout="horizontal"
            label="New"
            autoComplete="off"
          />
          <TextInput
            name="confirm-new-password"
            password
            value={confirmPassword}
            onChange={handleConfirmPasswordChange}
            layout="horizontal"
            label="Confirm"
            autoComplete="off"
            validate={handleConfirmPasswordValidation}
          />
        </div>
      </form>
    </Card>
  );
};

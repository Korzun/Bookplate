import { useMutation } from '@apollo/client/react';
import { Fragment, useCallback, useState } from 'react';

import type { UserResetPasswordMutation } from '~/gql/graphql';
import { UserResetPasswordDocument } from '~/graphql/user';
import { unwrapResult } from '~/provider/apollo';
import { useToast } from '~/provider/toast';

import { Button, ButtonRadiusValue } from '../button';
import { ConfirmModal } from '../confirm-modal';
import { PasswordResultModal } from '../password-result-modal';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type UserResetPasswordPayload = Extract<
  NonNullable<UserResetPasswordMutation['userResetPassword']>,
  { __typename: 'UserResetPasswordPayload' }
>;

interface ResetPasswordButtonProps {
  radius?: ButtonRadiusValue;
  userId: string;
  username: string;
}

/**
 * `useResetUserPassword` is inlined directly here rather than kept as a
 * `provider/user` hook — this button is its only caller. `userId`/
 * `username` come from `UserRow`'s own colocated fragment. `userResetPassword`
 * changes no field any cached read selects (`UserListDocument`'s `id`/
 * `username`/`progressCount` are all untouched by a password reset), so this
 * needs no `update` function at all.
 */
export const ResetPasswordButton = ({ radius, userId, username }: ResetPasswordButtonProps) => {
  const [runReset, { loading: resetting }] = useMutation(UserResetPasswordDocument);
  const showToast = useToast();

  const [showConfirm, setShowConfirm] = useState(false);
  const [password, setPassword] = useState<string | null>(null);

  const showResult = password !== null;

  const handleClick = useCallback(() => setShowConfirm(true), []);
  const handleCancel = useCallback(() => setShowConfirm(false), []);
  const handleConfirm = useCallback(async () => {
    setShowConfirm(false);
    try {
      const { data } = await runReset({ variables: { input: { userId } } });
      const result = unwrapResult<UserResetPasswordPayload>(
        data?.userResetPassword,
        'UserResetPasswordPayload'
      );
      if (result.status === 'missing') {
        showToast('Failed to reset password', 'error');
        return;
      }
      if (result.status === 'error') {
        showToast(result.message, 'error');
        return;
      }
      setPassword(result.payload.password);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to reset password', 'error');
    }
  }, [runReset, userId, showToast]);
  const handleDone = useCallback(() => {
    setPassword(null);
  }, []);

  return (
    <Fragment>
      <Button type="link" onClick={handleClick} loading={resetting} radius={radius}>
        Reset password
      </Button>
      <ConfirmModal
        isOpen={showConfirm}
        onCancel={handleCancel}
        onConfirm={() => void handleConfirm()}
        title={`Reset password for ${username}?`}
        confirmText="Reset password"
      >
        This generates a new login password and signs them in fresh — they&apos;ll be required to
        change it on their next login. The new password will be shown once; make sure to copy it
        before closing.
      </ConfirmModal>
      <PasswordResultModal
        isOpen={showResult}
        username={username}
        password={password}
        onDone={handleDone}
      />
    </Fragment>
  );
};

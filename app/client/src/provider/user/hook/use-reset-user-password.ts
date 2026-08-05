import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { UserResetPasswordMutation } from '~/gql/graphql';
import { UserResetPasswordDocument } from '~/graphql/user';
import { unwrapResult } from '~/provider/apollo';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type UserResetPasswordPayload = Extract<
  NonNullable<UserResetPasswordMutation['userResetPassword']>,
  { __typename: 'UserResetPasswordPayload' }
>;

export type ResetUserPassword = (userId: string) => Promise<string | null>;
export type UseResetUserPassword =
  | [ResetUserPassword, false, false, undefined] // Initial/ready
  | [ResetUserPassword, true, false, undefined] // Reset in progress
  | [ResetUserPassword, false, true, undefined] // Unspecified error
  | [ResetUserPassword, false, true, string]; // Specified error

/**
 * Takes a `User` global ID, not a username — `ResetPasswordButton` carries a
 * `userId` prop for this. `userResetPassword` changes no field any cached
 * read selects (`UserListDocument`'s `id`/`username`/`progressCount` are all
 * untouched by a password reset), so this needs no `update` function at
 * all — free, same as `useUpdateDevice`'s doc comment on why a returned
 * entity sometimes needs no cache surgery.
 */
export const useResetUserPassword = (): UseResetUserPassword => {
  const [runReset] = useMutation(UserResetPasswordDocument);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const resetUserPassword = useCallback(
    async (userId: string) => {
      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const { data } = await runReset({ variables: { input: { userId } } });

        const result = unwrapResult<UserResetPasswordPayload>(
          data?.userResetPassword,
          'UserResetPasswordPayload'
        );
        if (result.status === 'missing') {
          setError(true);
          setErrorMessage('Failed to reset password');
          return null;
        }
        if (result.status === 'error') {
          setError(true);
          setErrorMessage(result.message);
          return null;
        }

        return result.payload.password;
      } catch (err) {
        setError(true);
        if (err instanceof Error) {
          setErrorMessage(err.message);
        }
        return null;
      } finally {
        setLoading(false);
      }
    },
    [runReset]
  );

  return useMemo(
    () => [resetUserPassword, loading, error, errorMessage] as UseResetUserPassword,
    [resetUserPassword, loading, error, errorMessage]
  );
};

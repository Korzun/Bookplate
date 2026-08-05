import type { Reference } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { UserRegisterMutation } from '~/gql/graphql';
import { UserRegisterDocument } from '~/graphql/user';
import { unwrapResult } from '~/provider/apollo';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call (the second argument's type is itself derived FROM `TPayload`), so
// it is named explicitly here, extracted from the generated union rather
// than hand-duplicated.
type UserRegisterPayload = Extract<
  UserRegisterMutation['userRegister'],
  { __typename: 'UserRegisterPayload' }
>;

export type RegisterUser = (username: string) => Promise<string | null>;
export type UseRegisterUser =
  | [RegisterUser, false, false, undefined] // Initial/ready
  | [RegisterUser, true, false, undefined] // Registering
  | [RegisterUser, false, true, undefined] // Unspecified error
  | [RegisterUser, false, true, string]; // Specified error

/**
 * `userRegister` returns the created `User`, but a returned entity does not
 * insert itself into any list: `Viewer.users` is read separately by
 * `useUserList`, so this hook appends into it via `cache.modify` on the
 * `Viewer` singleton (`keyFields: []` in `cacheConfig` is what makes
 * `cache.identify({ __typename: 'Viewer' })` resolve to an addressable id) —
 * the same shape `useCreateDevice` uses for `Viewer.devices`.
 *
 * There is no client-side pre-validation of the username (no length/charset/
 * duplicate check before sending): the server enforces all of that
 * (`user/mutation/register.ts`) and reports it back as `InvalidInputError` or
 * `UsernameAlreadyExistsError`, both surfaced through this hook's existing
 * error slot exactly like `useCreateDevice` does for `DeviceSlugConflictError`.
 */
export const useRegisterUser = (): UseRegisterUser => {
  const [runRegister] = useMutation(UserRegisterDocument);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const registerUser = useCallback(
    async (username: string): Promise<string | null> => {
      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const { data } = await runRegister({
          variables: { input: { username } },
          update: (cache, { data: mutationData }) => {
            const created = unwrapResult<UserRegisterPayload>(
              mutationData?.userRegister,
              'UserRegisterPayload'
            );
            if (created.status !== 'ok') return;

            cache.modify({
              id: cache.identify({ __typename: 'Viewer' }),
              fields: {
                users: (existing: readonly Reference[] = [], { toReference }) => {
                  const ref = toReference(created.payload.user);
                  return ref ? [...existing, ref] : existing;
                },
              },
            });
          },
        });

        const result = unwrapResult<UserRegisterPayload>(data?.userRegister, 'UserRegisterPayload');
        if (result.status === 'missing') {
          setError(true);
          setErrorMessage('Registration failed');
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
        setErrorMessage(err instanceof Error ? err.message : 'Registration failed');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [runRegister]
  );

  return useMemo(
    () => [registerUser, loading, error, errorMessage] as UseRegisterUser,
    [registerUser, loading, error, errorMessage]
  );
};

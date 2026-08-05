import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { UserDeleteMutation } from '~/gql/graphql';
import { UserDeleteDocument } from '~/graphql/user';
import { unwrapResult } from '~/provider/apollo';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type UserDeletePayload = Extract<
  NonNullable<UserDeleteMutation['userDelete']>,
  { __typename: 'UserDeletePayload' }
>;

export type DeleteUser = (userId: string) => Promise<void>;
export type UseDeleteUser =
  | [DeleteUser, false, false, undefined] // Initial/ready
  | [DeleteUser, true, false, undefined] // Delete in progress
  | [DeleteUser, false, true, undefined] // Unspecified error
  | [DeleteUser, false, true, string]; // Specified error

/**
 * Takes a `User` global ID, not a username — `UserRow` already has `userId`
 * (Task 4). No `optimisticResponse` here, unlike `useDeleteDevice`: this
 * mutation has none, so `update` runs once, against the real response, and a
 * plain `cache.evict` is enough — `viewer.users` is an array of references,
 * which Apollo auto-filters once the referenced `User` entity is gone. Do
 * NOT add a `cache.modify` list filter alongside it: that is only needed to
 * hide an entity through an *optimistic* layer (see `use-delete-device.ts`'s
 * doc comment for why), which does not apply here.
 */
export const useDeleteUser = (): UseDeleteUser => {
  const [runDelete] = useMutation(UserDeleteDocument);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const deleteUser = useCallback(
    async (userId: string) => {
      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const { data } = await runDelete({
          variables: { input: { userId } },
          update: (cache, { data: mutationData }) => {
            const result = unwrapResult<UserDeletePayload>(
              mutationData?.userDelete,
              'UserDeletePayload'
            );
            if (result.status !== 'ok') return;

            cache.evict({
              id: cache.identify({ __typename: 'User', id: result.payload.deletedId }),
            });
          },
        });

        const result = unwrapResult<UserDeletePayload>(data?.userDelete, 'UserDeletePayload');
        if (result.status === 'missing') {
          setError(true);
          setErrorMessage('Failed to delete user');
          return;
        }
        if (result.status === 'error') {
          setError(true);
          setErrorMessage(result.message);
          return;
        }
      } catch (err) {
        setError(true);
        if (err instanceof Error) setErrorMessage(err.message);
      } finally {
        setLoading(false);
      }
    },
    [runDelete]
  );

  return useMemo(
    () => [deleteUser, loading, error, errorMessage] as UseDeleteUser,
    [deleteUser, loading, error, errorMessage]
  );
};

import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { DeviceDisableUserMutation } from '~/gql/graphql';
import { DeviceDisableUserDocument } from '~/graphql/device';
import { unwrapResult } from '~/provider/apollo';
import { useUserList } from '~/provider/user';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated. `deviceDisableUser` itself is nullable
// (resolves to null when the device or user no longer exists), so this
// unwraps `NonNullable` first, mirroring `use-update-device.ts`.
type DeviceDisableUserPayload = Extract<
  NonNullable<DeviceDisableUserMutation['deviceDisableUser']>,
  { __typename: 'DeviceDisableUserPayload' }
>;

export type DisableDeviceUser = (deviceId: string, username: string) => Promise<boolean>;
export type UseDisableDeviceUser =
  | [DisableDeviceUser, false, false, undefined]
  | [DisableDeviceUser, true, false, undefined]
  | [DisableDeviceUser, false, true, undefined]
  | [DisableDeviceUser, false, true, string];

/**
 * Mirrors `use-enable-device-user.ts`'s reasoning: takes a username, resolves
 * it to a `User` global id against the already-cached `useUserList()`, and
 * needs no `update` function since `deviceDisableUser` returns `device { id
 * enabledUsers { id } }`, normalizing over the existing `Device:<id>` entity.
 */
export const useDisableDeviceUser = (): UseDisableDeviceUser => {
  const [runDisable] = useMutation(DeviceDisableUserDocument);
  const [allUsers] = useUserList();
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const disable = useCallback(
    async (deviceId: string, username: string): Promise<boolean> => {
      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const user = allUsers.find((candidate) => candidate.username === username);
        if (!user) throw new Error(`Unknown user "${username}"`);

        const { data } = await runDisable({
          variables: { input: { deviceId, userId: user.id } },
        });

        const result = unwrapResult<DeviceDisableUserPayload>(
          data?.deviceDisableUser,
          'DeviceDisableUserPayload'
        );
        if (result.status === 'missing') {
          setError(true);
          setErrorMessage('Failed to disable user');
          return false;
        }
        if (result.status === 'error') {
          setError(true);
          setErrorMessage(result.message);
          return false;
        }

        return true;
      } catch (err) {
        setError(true);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to disable user');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [runDisable, allUsers]
  );

  return useMemo(
    () => [disable, loading, error, errorMessage] as UseDisableDeviceUser,
    [disable, loading, error, errorMessage]
  );
};

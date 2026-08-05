import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { DeviceEnableUserMutation } from '~/gql/graphql';
import { DeviceEnableUserDocument } from '~/graphql/device';
import { unwrapResult } from '~/provider/apollo';
import { useUserList } from '~/provider/user';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated. `deviceEnableUser` itself is nullable
// (resolves to null when the device or user no longer exists), so this
// unwraps `NonNullable` first, mirroring `use-update-device.ts`.
type DeviceEnableUserPayload = Extract<
  NonNullable<DeviceEnableUserMutation['deviceEnableUser']>,
  { __typename: 'DeviceEnableUserPayload' }
>;

export type EnableDeviceUser = (deviceId: string, username: string) => Promise<boolean>;
export type UseEnableDeviceUser =
  | [EnableDeviceUser, false, false, undefined]
  | [EnableDeviceUser, true, false, undefined]
  | [EnableDeviceUser, false, true, undefined]
  | [EnableDeviceUser, false, true, string];

/**
 * `deviceEnableUser` takes a `User` global id, not a username — the schema's
 * own rule for every user-associated mutation. This hook's public signature
 * keeps taking a username (device-form's `ChipsInput` deals in chip values,
 * which are usernames) and resolves it against the already-cached
 * `useUserList()` (Task 4's `UserListDocument`) rather than adding a lookup
 * query of its own.
 *
 * `deviceEnableUser` returns `device { id enabledUsers { id } }`, which
 * normalizes over the existing `Device:<id>` entity — no `update` function
 * needed here; `useDeviceUsers`'s cached read of the same device picks up
 * the change for free (verified in this file's test with no `update`
 * supplied).
 */
export const useEnableDeviceUser = (): UseEnableDeviceUser => {
  const [runEnable] = useMutation(DeviceEnableUserDocument);
  const [allUsers] = useUserList();
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const enable = useCallback(
    async (deviceId: string, username: string): Promise<boolean> => {
      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const user = allUsers.find((candidate) => candidate.username === username);
        if (!user) throw new Error(`Unknown user "${username}"`);

        const { data } = await runEnable({
          variables: { input: { deviceId, userId: user.id } },
        });

        const result = unwrapResult<DeviceEnableUserPayload>(
          data?.deviceEnableUser,
          'DeviceEnableUserPayload'
        );
        if (result.status === 'missing') {
          setError(true);
          setErrorMessage('Failed to enable user');
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
        setErrorMessage(err instanceof Error ? err.message : 'Failed to enable user');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [runEnable, allUsers]
  );

  return useMemo(
    () => [enable, loading, error, errorMessage] as UseEnableDeviceUser,
    [enable, loading, error, errorMessage]
  );
};

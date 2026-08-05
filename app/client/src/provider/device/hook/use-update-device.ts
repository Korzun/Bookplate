import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { DeviceUpdateMutation } from '~/gql/graphql';
import { DeviceUpdateDocument } from '~/graphql/device';
import { unwrapResult } from '~/provider/apollo';

import type { Device, DeviceInput } from '../type';
import { coverFitToGraphQL, deviceFromGraphQL } from './util';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type DeviceUpdatePayload = Extract<
  NonNullable<DeviceUpdateMutation['deviceUpdate']>,
  { __typename: 'DeviceUpdatePayload' }
>;

export type UpdateDevice = (id: string, input: DeviceInput) => Promise<Device | null>;
export type UseUpdateDevice =
  | [UpdateDevice, false, false, undefined] // Initial/ready
  | [UpdateDevice, true, false, undefined] // Updating
  | [UpdateDevice, false, true, undefined] // Unspecified error
  | [UpdateDevice, false, true, string]; // Specified error

/**
 * `deviceUpdate` returns the updated `Device` outright, which normalizes over
 * the existing `Device:<id>` entity — every cached read (`useDeviceList`
 * included) picks up the change for free. No `update` function needed here,
 * unlike `useCreateDevice`'s append.
 *
 * `DeviceSlugConflictError` and `InvalidInputError` are both real, reachable
 * outcomes surfaced through this hook's existing error slot — the form
 * already renders whichever message lands there.
 */
export const useUpdateDevice = (): UseUpdateDevice => {
  const [runUpdate] = useMutation(DeviceUpdateDocument);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const updateDevice = useCallback(
    async (id: string, input: DeviceInput): Promise<Device | null> => {
      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const { data } = await runUpdate({
          variables: {
            input: {
              deviceId: id,
              name: input.name,
              coverWidth: input.coverWidth,
              coverHeight: input.coverHeight,
              coverFit: coverFitToGraphQL(input.coverFit),
              bwCover: input.bwCover,
              simplify: input.simplify,
            },
          },
        });

        const result = unwrapResult<DeviceUpdatePayload>(data?.deviceUpdate, 'DeviceUpdatePayload');
        if (result.status === 'missing') {
          setError(true);
          setErrorMessage('Failed to update device');
          return null;
        }
        if (result.status === 'error') {
          setError(true);
          setErrorMessage(result.message);
          return null;
        }

        return deviceFromGraphQL(result.payload.device);
      } catch (err) {
        setError(true);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to update device');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [runUpdate]
  );

  return useMemo(
    () => [updateDevice, loading, error, errorMessage] as UseUpdateDevice,
    [updateDevice, loading, error, errorMessage]
  );
};

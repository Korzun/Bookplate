import type { Reference } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { DeviceCreateMutation } from '~/gql/graphql';
import { DeviceCreateDocument } from '~/graphql/device';
import { unwrapResult } from '~/provider/apollo';

import type { Device, DeviceInput } from '../type';
import { coverFitToGraphQL, deviceFromGraphQL } from './util';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call (the second argument's type is itself derived FROM `TPayload`), so
// every call site names it explicitly via this alias, extracted from the
// generated union rather than hand-duplicated.
type DeviceCreatePayload = Extract<
  DeviceCreateMutation['deviceCreate'],
  { __typename: 'DeviceCreatePayload' }
>;

export type CreateDevice = (input: DeviceInput) => Promise<Device | null>;
export type UseCreateDevice =
  | [CreateDevice, false, false, undefined] // Initial/ready
  | [CreateDevice, true, false, undefined] // Creating
  | [CreateDevice, false, true, undefined] // Unspecified error
  | [CreateDevice, false, true, string]; // Specified error

/**
 * `deviceCreate` returns the created `Device`, but a returned entity does not
 * insert itself into any list: `Viewer.devices` is read separately by
 * `useDeviceList`, so this hook appends into it via `cache.modify` on the
 * `Viewer` singleton (`keyFields: []` in `cacheConfig` is what makes
 * `cache.identify({ __typename: 'Viewer' })` resolve to an addressable id).
 *
 * `DeviceSlugConflictError` and `InvalidInputError` are both real, reachable
 * outcomes surfaced through this hook's existing error slot — the form
 * already renders whichever message lands there.
 */
export const useCreateDevice = (): UseCreateDevice => {
  const [runCreate] = useMutation(DeviceCreateDocument);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const createDevice = useCallback(
    async (input: DeviceInput): Promise<Device | null> => {
      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const { data } = await runCreate({
          variables: {
            input: {
              name: input.name,
              coverWidth: input.coverWidth,
              coverHeight: input.coverHeight,
              coverFit: coverFitToGraphQL(input.coverFit),
              bwCover: input.bwCover,
              simplify: input.simplify,
            },
          },
          update: (cache, { data: mutationData }) => {
            const created = unwrapResult<DeviceCreatePayload>(
              mutationData?.deviceCreate,
              'DeviceCreatePayload'
            );
            if (created.status !== 'ok') return;

            cache.modify({
              id: cache.identify({ __typename: 'Viewer' }),
              fields: {
                devices: (existing: readonly Reference[] = [], { toReference }) => {
                  const ref = toReference(created.payload.device);
                  return ref ? [...existing, ref] : existing;
                },
              },
            });
          },
        });

        const result = unwrapResult<DeviceCreatePayload>(data?.deviceCreate, 'DeviceCreatePayload');
        if (result.status === 'missing') {
          setError(true);
          setErrorMessage('Failed to create device');
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
        setErrorMessage(err instanceof Error ? err.message : 'Failed to create device');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [runCreate]
  );

  return useMemo(
    () => [createDevice, loading, error, errorMessage] as UseCreateDevice,
    [createDevice, loading, error, errorMessage]
  );
};

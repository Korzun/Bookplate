import type { Reference } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';

import type { DeviceDeleteMutation } from '~/gql/graphql';
import { DeviceDeleteDocument } from '~/graphql/device';
import { unwrapResult } from '~/provider/apollo';

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type DeviceDeletePayload = Extract<
  NonNullable<DeviceDeleteMutation['deviceDelete']>,
  { __typename: 'DeviceDeletePayload' }
>;

export type DeleteDevice = (id: string) => Promise<void>;
export type UseDeleteDevice =
  | [DeleteDevice, false, false, undefined] // Initial/ready
  | [DeleteDevice, true, false, undefined] // Delete in progress
  | [DeleteDevice, false, true, undefined] // Unspecified error
  | [DeleteDevice, false, true, string]; // Specified error

/**
 * `optimisticResponse` names the concrete union member's `__typename` and
 * supplies every field the mutation selects (just `deletedDeviceId`), which
 * is what lets the SAME `update` function run against it immediately, both
 * optimistically and for the real response.
 *
 * `update` does BOTH a `cache.modify` filter on `Viewer.devices` AND a
 * `cache.evict` of the `Device` entity — not evict alone. `Device:<id>` lives
 * in the ROOT cache layer (written by the earlier `DeviceList` read), and
 * `InMemoryCache.evict()` deliberately passes the active optimistic layer as
 * its own recursion limit ("so evictions during optimistic updates … do not
 * escape their optimistic Layer" — `inMemoryCache.js`, `evict()`), so an
 * evict issued from inside the optimistic pass cannot hide an entity that
 * exists only in a parent layer: it finds nothing of its own to remove and
 * is a no-op there. `cache.modify`, unlike `evict`, does not have that
 * restriction — filtering the reference out of `Viewer.devices` writes a
 * shadow copy of the field into whichever layer is currently active, so it
 * takes effect immediately during the optimistic pass, and again (redundant
 * but harmless) once the real response lands. `evict` is kept alongside it
 * so the normalized `Device` entity itself doesn't linger once the deletion
 * is confirmed, rather than only ever being hidden from this one list.
 *
 * Rollback on failure is Apollo's optimistic layer doing its job, not a
 * hand-written restore: a thrown network/GraphQL error discards the
 * optimistic layer outright, and a typed error or `missing` result still
 * reaches `update` with the REAL data — that call's `status !== 'ok'` guard
 * runs neither the filter nor the evict, so the device is simply never
 * removed from the root layer and reappears once the optimistic layer is
 * gone.
 */
export const useDeleteDevice = (): UseDeleteDevice => {
  const [runDelete] = useMutation(DeviceDeleteDocument);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const deleteDevice = useCallback(
    async (id: string) => {
      try {
        setLoading(true);
        setError(false);
        setErrorMessage(undefined);

        const { data } = await runDelete({
          variables: { input: { deviceId: id } },
          optimisticResponse: {
            __typename: 'Mutation',
            deviceDelete: {
              __typename: 'DeviceDeletePayload',
              deletedDeviceId: id,
            },
          },
          update: (cache, { data: mutationData }) => {
            const result = unwrapResult<DeviceDeletePayload>(
              mutationData?.deviceDelete,
              'DeviceDeletePayload'
            );
            if (result.status !== 'ok') return;

            const deletedDeviceId = result.payload.deletedDeviceId;

            cache.modify({
              id: cache.identify({ __typename: 'Viewer' }),
              fields: {
                devices: (existing: readonly Reference[] = [], { readField }) =>
                  existing.filter((deviceRef) => readField('id', deviceRef) !== deletedDeviceId),
              },
            });

            cache.evict({
              id: cache.identify({ __typename: 'Device', id: deletedDeviceId }),
            });
          },
        });

        const result = unwrapResult<DeviceDeletePayload>(data?.deviceDelete, 'DeviceDeletePayload');
        if (result.status === 'missing') {
          setError(true);
          setErrorMessage('Failed to delete device');
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
    () => [deleteDevice, loading, error, errorMessage] as UseDeleteDevice,
    [deleteDevice, loading, error, errorMessage]
  );
};

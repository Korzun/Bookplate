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
 * is what lets the SAME `update` function run against it immediately, exactly
 * as instructed. Measured caveat, not a hypothetical: `cache.evict()` inside
 * that optimistic pass is a no-op here. `Device:<id>` lives in the ROOT layer
 * (written by the earlier `DeviceList` read), and `InMemoryCache.evict()`
 * deliberately passes the active (optimistic) layer as its OWN recursion
 * limit — "so evictions during optimistic updates … do not escape their
 * optimistic Layer" (`inMemoryCache.js`, `evict()`) — so the optimistic call
 * finds nothing of its own to delete and returns `false`. `viewer.devices`
 * therefore keeps showing the device (confirmed via `readQuery({ optimistic:
 * true })`) until the REAL response lands, at which point the SAME `update`
 * runs again outside any optimistic transaction, `cache.evict()` succeeds
 * against the root layer, and Apollo auto-filters the now-dangling reference
 * out of `viewer.devices` — no hand-written list filter needed for that step.
 *
 * Rollback on failure is Apollo's optimistic layer doing its job, not a
 * hand-written restore: a thrown network/GraphQL error discards the
 * optimistic layer outright, and a typed error or `missing` result still
 * reaches `update` with the REAL data — that call's `status !== 'ok'` guard
 * evicts nothing, so the device is simply never evicted from the root layer.
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

            cache.evict({
              id: cache.identify({ __typename: 'Device', id: result.payload.deletedDeviceId }),
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

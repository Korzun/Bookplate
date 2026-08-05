import type { ApolloClient } from '@apollo/client';
import { useApolloClient } from '@apollo/client/react';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeviceDeleteDocument, DeviceListDocument } from '~/graphql/device';
import { renderWithApollo } from '~/test-utils';

import { useDeleteDevice, type UseDeleteDevice } from './use-delete-device';

const kindle = {
  __typename: 'Device' as const,
  id: 'd1',
  name: 'Kindle',
  slug: 'kindle',
  coverWidth: null,
  coverHeight: null,
  coverFit: 'CONTAIN' as const,
  bwCover: false,
  simplify: true,
};

const deleteSuccessMock = {
  request: { query: DeviceDeleteDocument, variables: { input: { deviceId: 'd1' } } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      deviceDelete: { __typename: 'DeviceDeletePayload' as const, deletedDeviceId: 'd1' },
    },
  },
};

type Harness = { deleteDevice: UseDeleteDevice; client: ApolloClient };

const renderDeleteDevice = (
  mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']
) => {
  const result: { current?: Harness } = {};
  const Probe = () => {
    result.current = { deleteDevice: useDeleteDevice(), client: useApolloClient() };
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

const seedDeviceList = (client: ApolloClient, devices: (typeof kindle)[]) =>
  client.writeQuery({
    query: DeviceListDocument,
    data: { __typename: 'Query', viewer: { __typename: 'Viewer', devices } },
  });

describe('useDeleteDevice', () => {
  it('returns a deleteDevice function and initial false/undefined state', () => {
    const result = renderDeleteDevice([]);
    const [deleteDevice, loading, error, errorMessage] = result.current!.deleteDevice;
    expect(typeof deleteDevice).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  // Documents a measured Apollo behavior, not a hypothetical: `cache.evict()`
  // called from the `optimisticResponse` pass is a no-op for an entity that
  // lives in the ROOT layer (as `Device:d1` does here, written before this
  // mutation runs). `InMemoryCache.evict()` deliberately passes the active
  // optimistic layer as its own recursion limit, so eviction cannot escape
  // it — see the comment on `useDeleteDevice`. Both an optimistic read
  // (`{ optimistic: true }`) and the default (root-only) read show the
  // device still present while the mutation is pending; only `loading`
  // reflects the in-flight state during this window.
  it('does not hide the device from any cache read while the mutation is pending — cache.evict cannot escape the optimistic layer', async () => {
    const result = renderDeleteDevice([{ ...deleteSuccessMock, delay: 20 }]);
    act(() => seedDeviceList(result.current!.client, [kindle]));

    act(() => {
      void result.current!.deleteDevice[0]('d1');
    });

    expect(result.current!.deleteDevice[1]).toBe(true);
    const optimistic = result.current!.client.readQuery({
      query: DeviceListDocument,
      optimistic: true,
    });
    expect(optimistic?.viewer.devices).toEqual([kindle]);
    const base = result.current!.client.readQuery({ query: DeviceListDocument });
    expect(base?.viewer.devices).toEqual([kindle]);

    await waitFor(() => expect(result.current!.deleteDevice[1]).toBe(false));
  });

  // The task's real content: `viewer.devices` is an array of references,
  // which Apollo auto-filters once `Device:d1` is evicted — no hand-written
  // list filter. Proven by reading the cache directly.
  it('evicts the deleted device so a subsequent DeviceList cache read no longer includes it', async () => {
    const result = renderDeleteDevice([deleteSuccessMock]);
    act(() => seedDeviceList(result.current!.client, [kindle]));

    await act(() => result.current!.deleteDevice[0]('d1'));

    const cached = result.current!.client.readQuery({ query: DeviceListDocument });
    expect(cached?.viewer.devices).toEqual([]);
  });

  it('restores the device in the cache and surfaces the message when the mutation throws', async () => {
    const result = renderDeleteDevice([
      {
        request: { query: DeviceDeleteDocument, variables: { input: { deviceId: 'd1' } } },
        error: new Error('Network error'),
      },
    ]);
    act(() => seedDeviceList(result.current!.client, [kindle]));

    await act(() => result.current!.deleteDevice[0]('d1'));

    expect(result.current!.deleteDevice[2]).toBe(true);
    expect(result.current!.deleteDevice[3]).toBe('Network error');
    const cached = result.current!.client.readQuery({ query: DeviceListDocument });
    expect(cached?.viewer.devices).toEqual([kindle]);
  });

  // `deviceDelete` returning a typed error (rather than throwing) still runs
  // `update` with the REAL result, which does not evict — the optimistic
  // (evicting) layer is superseded by that non-evicting one, so the device
  // reappears without any hand-written restore step.
  it('restores the device in the cache and surfaces the message on a typed InvalidInputError', async () => {
    const result = renderDeleteDevice([
      {
        request: { query: DeviceDeleteDocument, variables: { input: { deviceId: 'd1' } } },
        result: {
          data: {
            __typename: 'Mutation' as const,
            deviceDelete: { __typename: 'InvalidInputError' as const, message: 'Device not found' },
          },
        },
      },
    ]);
    act(() => seedDeviceList(result.current!.client, [kindle]));

    await act(() => result.current!.deleteDevice[0]('d1'));

    expect(result.current!.deleteDevice[2]).toBe(true);
    expect(result.current!.deleteDevice[3]).toBe('Device not found');
    const cached = result.current!.client.readQuery({ query: DeviceListDocument });
    expect(cached?.viewer.devices).toEqual([kindle]);
  });
});

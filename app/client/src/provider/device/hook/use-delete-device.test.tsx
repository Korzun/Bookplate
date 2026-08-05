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

const zebra = {
  __typename: 'Device' as const,
  id: 'd2',
  name: 'Zebra reader',
  slug: 'zebra',
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

  // Preserves the REST version's optimistic removal: the deleted device is
  // gone from a cache read the instant the mutation starts, well before the
  // (here, deliberately delayed) response lands — proven against a
  // two-device seed so this is "d1 filtered out", not "the list emptied".
  it('hides the deleted device from a cache read while the mutation is pending', async () => {
    const result = renderDeleteDevice([{ ...deleteSuccessMock, delay: 20 }]);
    act(() => seedDeviceList(result.current!.client, [kindle, zebra]));

    act(() => {
      void result.current!.deleteDevice[0]('d1');
    });

    expect(result.current!.deleteDevice[1]).toBe(true);
    const optimistic = result.current!.client.readQuery({
      query: DeviceListDocument,
      optimistic: true,
    });
    expect(optimistic?.viewer.devices).toEqual([zebra]);

    await waitFor(() => expect(result.current!.deleteDevice[1]).toBe(false));
  });

  // The task's real content: once the real response lands, the device stays
  // gone from a plain (non-optimistic) cache read too — the entity itself is
  // evicted, not just hidden from this one list.
  it('evicts the deleted device so a subsequent DeviceList cache read no longer includes it', async () => {
    const result = renderDeleteDevice([deleteSuccessMock]);
    act(() => seedDeviceList(result.current!.client, [kindle]));

    await act(() => result.current!.deleteDevice[0]('d1'));

    const cached = result.current!.client.readQuery({ query: DeviceListDocument });
    expect(cached?.viewer.devices).toEqual([]);
  });

  // The half most likely to be silently broken: the device disappears
  // immediately (optimistic hide), then REAPPEARS once the mutation actually
  // fails — Apollo discards the optimistic layer on a thrown error, and the
  // filter/evict never ran against the root layer, so nothing needs a
  // hand-written restore.
  it('hides the device optimistically, then restores it and surfaces the message when the mutation throws', async () => {
    const result = renderDeleteDevice([
      {
        request: { query: DeviceDeleteDocument, variables: { input: { deviceId: 'd1' } } },
        error: new Error('Network error'),
        delay: 20,
      },
    ]);
    act(() => seedDeviceList(result.current!.client, [kindle]));

    act(() => {
      void result.current!.deleteDevice[0]('d1');
    });

    const optimistic = result.current!.client.readQuery({
      query: DeviceListDocument,
      optimistic: true,
    });
    expect(optimistic?.viewer.devices).toEqual([]);

    await waitFor(() => expect(result.current!.deleteDevice[1]).toBe(false));

    expect(result.current!.deleteDevice[2]).toBe(true);
    expect(result.current!.deleteDevice[3]).toBe('Network error');
    const cached = result.current!.client.readQuery({ query: DeviceListDocument });
    expect(cached?.viewer.devices).toEqual([kindle]);
  });

  // `deviceDelete` returning a typed error (rather than throwing) still runs
  // `update` with the REAL result — that call's `status !== 'ok'` guard runs
  // neither the filter nor the evict, so the device is simply never removed
  // from the root layer and the device reappears once the optimistic layer
  // is discarded, without any hand-written restore step.
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

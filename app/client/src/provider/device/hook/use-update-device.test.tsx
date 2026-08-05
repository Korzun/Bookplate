import type { ApolloClient } from '@apollo/client';
import { useApolloClient } from '@apollo/client/react';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeviceListDocument, DeviceUpdateDocument } from '~/graphql/device';
import { renderWithApollo } from '~/test-utils';

import type { DeviceInput } from '../type';
import { useUpdateDevice, type UseUpdateDevice } from './use-update-device';

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

const editedInput: DeviceInput = {
  name: 'Kindle',
  coverWidth: 600,
  coverHeight: 800,
  coverFit: 'cover',
  bwCover: true,
  simplify: false,
};

/** What the hook sends over the wire: `deviceId` alongside the mapped input. */
const editedGraphQLInput = {
  deviceId: 'd1',
  name: 'Kindle',
  coverWidth: 600,
  coverHeight: 800,
  coverFit: 'COVER' as const,
  bwCover: true,
  simplify: false,
};

const editedDevice = {
  __typename: 'Device' as const,
  id: 'd1',
  name: 'Kindle',
  slug: 'kindle',
  coverWidth: 600,
  coverHeight: 800,
  coverFit: 'COVER' as const,
  bwCover: true,
  simplify: false,
};

const updateSuccessMock = {
  request: { query: DeviceUpdateDocument, variables: { input: editedGraphQLInput } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      deviceUpdate: { __typename: 'DeviceUpdatePayload' as const, device: editedDevice },
    },
  },
};

const conflictMock = {
  request: { query: DeviceUpdateDocument, variables: { input: editedGraphQLInput } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      deviceUpdate: {
        __typename: 'DeviceSlugConflictError' as const,
        message: 'A device with this name already exists',
      },
    },
  },
};

const missingMock = {
  request: { query: DeviceUpdateDocument, variables: { input: editedGraphQLInput } },
  result: { data: { __typename: 'Mutation' as const, deviceUpdate: null } },
};

type Harness = { update: UseUpdateDevice; client: ApolloClient };

const renderUpdateDevice = (
  mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']
) => {
  const result: { current?: Harness } = {};
  const Probe = () => {
    result.current = { update: useUpdateDevice(), client: useApolloClient() };
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

describe('useUpdateDevice', () => {
  it('returns an updateDevice function and initial false/undefined state', () => {
    const result = renderUpdateDevice([]);
    const [updateDevice, loading, error, errorMessage] = result.current!.update;
    expect(typeof updateDevice).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('sends the DeviceUpdate mutation with deviceId and the mapped input, returning the updated device', async () => {
    const result = renderUpdateDevice([updateSuccessMock]);
    act(() => seedDeviceList(result.current!.client, [kindle]));

    // MockLink throws on an unmatched request, so resolving without error
    // already proves deviceId and the mapped variables match.
    const device = await act(() => result.current!.update[0]('d1', editedInput));
    expect(device).toEqual({
      id: 'd1',
      name: 'Kindle',
      slug: 'kindle',
      coverWidth: 600,
      coverHeight: 800,
      coverFit: 'cover',
      bwCover: true,
      simplify: false,
    });
  });

  // The task's real content: no `update` function is passed to this
  // mutation at all — `deviceUpdate` returning the `Device` outright is what
  // normalizes over the existing `Device:d1` entity and refreshes this read.
  it('updates the cached DeviceList read with no explicit update function', async () => {
    const result = renderUpdateDevice([updateSuccessMock]);
    act(() => seedDeviceList(result.current!.client, [kindle]));

    await act(() => result.current!.update[0]('d1', editedInput));

    const cached = result.current!.client.readQuery({ query: DeviceListDocument });
    expect(cached?.viewer.devices).toEqual([editedDevice]);
  });

  it('surfaces a DeviceSlugConflictError message and leaves the cached device unchanged', async () => {
    const result = renderUpdateDevice([conflictMock]);
    act(() => seedDeviceList(result.current!.client, [kindle]));

    const device = await act(() => result.current!.update[0]('d1', editedInput));
    expect(device).toBeNull();
    expect(result.current!.update[2]).toBe(true);
    expect(result.current!.update[3]).toBe('A device with this name already exists');

    const cached = result.current!.client.readQuery({ query: DeviceListDocument });
    expect(cached?.viewer.devices).toEqual([kindle]);
  });

  // `deviceUpdate` resolves null when `deviceId` no longer exists — a
  // distinct third case from a typed error, per `unwrapResult`'s contract.
  it('reports a null result as a generic failure, not the server error branch', async () => {
    const result = renderUpdateDevice([missingMock]);
    act(() => seedDeviceList(result.current!.client, [kindle]));

    const device = await act(() => result.current!.update[0]('d1', editedInput));
    expect(device).toBeNull();
    expect(result.current!.update[2]).toBe(true);
    expect(result.current!.update[3]).toBe('Failed to update device');
  });
});

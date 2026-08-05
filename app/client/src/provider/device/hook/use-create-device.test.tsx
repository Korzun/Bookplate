import type { ApolloClient } from '@apollo/client';
import { useApolloClient } from '@apollo/client/react';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeviceCreateDocument, DeviceListDocument } from '~/graphql/device';
import { renderWithApollo } from '~/test-utils';

import type { DeviceInput } from '../type';
import { useCreateDevice, type UseCreateDevice } from './use-create-device';

const kindleInput: DeviceInput = {
  name: 'Kindle',
  coverWidth: null,
  coverHeight: null,
  coverFit: 'contain',
  bwCover: false,
  simplify: true,
};

/** What the hook sends over the wire: the client's lowercase `coverFit`
 * mapped to the GraphQL enum, everything else passed through unchanged. */
const kindleGraphQLInput = {
  name: 'Kindle',
  coverWidth: null,
  coverHeight: null,
  coverFit: 'CONTAIN' as const,
  bwCover: false,
  simplify: true,
};

const createdDevice = {
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

const createSuccessMock = {
  request: { query: DeviceCreateDocument, variables: { input: kindleGraphQLInput } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      deviceCreate: { __typename: 'DeviceCreatePayload' as const, device: createdDevice },
    },
  },
};

const conflictMock = {
  request: { query: DeviceCreateDocument, variables: { input: kindleGraphQLInput } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      deviceCreate: {
        __typename: 'DeviceSlugConflictError' as const,
        message: 'A device with this name already exists',
      },
    },
  },
};

type Harness = { create: UseCreateDevice; client: ApolloClient };

const renderCreateDevice = (
  mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']
) => {
  const result: { current?: Harness } = {};
  const Probe = () => {
    result.current = { create: useCreateDevice(), client: useApolloClient() };
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

/** Seeds an empty `DeviceList` read, mirroring the cache state before any
 * device exists — the append's starting point. */
const seedEmptyDeviceList = (client: ApolloClient) =>
  client.writeQuery({
    query: DeviceListDocument,
    data: { __typename: 'Query', viewer: { __typename: 'Viewer', devices: [] } },
  });

describe('useCreateDevice', () => {
  it('returns createDevice function and initial false/undefined state', () => {
    const result = renderCreateDevice([]);
    const [createDevice, loading, error, errorMessage] = result.current!.create;
    expect(typeof createDevice).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('sends the DeviceCreate mutation with the mapped input and returns the created device', async () => {
    const result = renderCreateDevice([createSuccessMock]);
    act(() => seedEmptyDeviceList(result.current!.client));

    // MockLink throws on an unmatched request, so resolving without error
    // already proves the variables (including the uppercased coverFit) match.
    const device = await act(() => result.current!.create[0](kindleInput));
    expect(device).toEqual({
      id: 'd1',
      name: 'Kindle',
      slug: 'kindle',
      coverWidth: null,
      coverHeight: null,
      coverFit: 'contain',
      bwCover: false,
      simplify: true,
    });
  });

  // The task's real content: a returned entity does not insert itself into a
  // list, so this proves the `cache.modify` append actually ran, by reading
  // the cache directly rather than re-mocking DeviceList.
  it('appends the created device to a subsequent DeviceList cache read', async () => {
    const result = renderCreateDevice([createSuccessMock]);
    act(() => seedEmptyDeviceList(result.current!.client));

    await act(() => result.current!.create[0](kindleInput));

    const cached = result.current!.client.readQuery({ query: DeviceListDocument });
    expect(cached?.viewer.devices).toEqual([createdDevice]);
  });

  it('surfaces a DeviceSlugConflictError message and does not append anything', async () => {
    const result = renderCreateDevice([conflictMock]);
    act(() => seedEmptyDeviceList(result.current!.client));

    const device = await act(() => result.current!.create[0](kindleInput));
    expect(device).toBeNull();
    expect(result.current!.create[2]).toBe(true);
    expect(result.current!.create[3]).toBe('A device with this name already exists');

    const cached = result.current!.client.readQuery({ query: DeviceListDocument });
    expect(cached?.viewer.devices).toEqual([]);
  });

  it('sets loading to true while the mutation is pending', async () => {
    const result = renderCreateDevice([{ ...createSuccessMock, delay: 20 }]);
    act(() => seedEmptyDeviceList(result.current!.client));

    act(() => {
      void result.current!.create[0](kindleInput);
    });
    await waitFor(() => expect(result.current!.create[1]).toBe(true));
    await waitFor(() => expect(result.current!.create[1]).toBe(false));
  });
});

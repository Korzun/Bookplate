import type { ApolloClient } from '@apollo/client';
import { useApolloClient } from '@apollo/client/react';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeviceEnableUserDocument, DeviceUsersDocument } from '~/graphql/device';
import { UserListDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { useEnableDeviceUser, type UseEnableDeviceUser } from './use-enable-device-user';

const alice = { __typename: 'User' as const, id: 'u1', username: 'alice', progressCount: 0 };
const bob = { __typename: 'User' as const, id: 'u2', username: 'bob', progressCount: 0 };

const userListMock = (users: (typeof alice)[]) => ({
  request: { query: UserListDocument },
  result: {
    data: { __typename: 'Query' as const, viewer: { __typename: 'Viewer' as const, users } },
  },
});

const enableSuccessMock = (deviceId: string, userId: string, enabledUserIds: string[]) => ({
  request: { query: DeviceEnableUserDocument, variables: { input: { deviceId, userId } } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      deviceEnableUser: {
        __typename: 'DeviceEnableUserPayload' as const,
        device: {
          __typename: 'Device' as const,
          id: deviceId,
          enabledUsers: enabledUserIds.map((id) => ({ __typename: 'User' as const, id })),
        },
      },
    },
  },
});

const invalidInputMock = (deviceId: string, userId: string, message: string) => ({
  request: { query: DeviceEnableUserDocument, variables: { input: { deviceId, userId } } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      deviceEnableUser: { __typename: 'InvalidInputError' as const, message },
    },
  },
});

const missingMock = (deviceId: string, userId: string) => ({
  request: { query: DeviceEnableUserDocument, variables: { input: { deviceId, userId } } },
  result: { data: { __typename: 'Mutation' as const, deviceEnableUser: null } },
});

type Harness = { enable: UseEnableDeviceUser; client: ApolloClient };

const renderEnableDeviceUser = (
  mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']
) => {
  const result: { current?: Harness } = {};
  const Probe = () => {
    result.current = { enable: useEnableDeviceUser(), client: useApolloClient() };
    return null;
  };
  renderWithApollo(<Probe />, { mocks, user: { username: 'admin', isAdmin: true } });
  return result;
};

/** `useEnableDeviceUser` resolves a username against the cached UserList
 * before it can even build variables — so every test here first waits for
 * that read to actually land in the cache, otherwise the lookup would race
 * the (identical, in the test file) mock data and flake. */
const waitForUserList = async (result: { current?: Harness }) =>
  waitFor(() => {
    expect(result.current!.client.readQuery({ query: UserListDocument })).not.toBeNull();
  });

const seedDeviceUsers = (
  client: ApolloClient,
  devices: { id: string; enabledUserIds: string[] }[]
) =>
  client.writeQuery({
    query: DeviceUsersDocument,
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        devices: devices.map((d) => ({
          __typename: 'Device' as const,
          id: d.id,
          enabledUsers: d.enabledUserIds.map((id) => ({ __typename: 'User' as const, id })),
        })),
      },
    },
  });

describe('useEnableDeviceUser', () => {
  it('returns an enable function and initial false/undefined state', () => {
    const result = renderEnableDeviceUser([userListMock([alice])]);
    const [enable, loading, error, errorMessage] = result.current!.enable;
    expect(typeof enable).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('resolves the username to a User global id and sends DeviceEnableUser, returning true', async () => {
    const result = renderEnableDeviceUser([
      userListMock([alice, bob]),
      enableSuccessMock('d1', 'u2', ['u1', 'u2']),
    ]);
    await waitForUserList(result);

    // MockLink throws on an unmatched request, so resolving without error
    // already proves the username→id resolution matched the mock's variables.
    const ok = await act(() => result.current!.enable[0]('d1', 'bob'));
    expect(ok).toBe(true);
  });

  /**
   * The task's real content: no `update` function is passed to this
   * mutation at all — `deviceEnableUser` returning `device { id enabledUsers
   * { id } }` outright is what normalizes over the existing `Device:d1`
   * entity and refreshes this cached read, with no cache-write code of this
   * hook's own.
   */
  it('updates a cached DeviceUsers read with no explicit update function', async () => {
    const result = renderEnableDeviceUser([
      userListMock([alice, bob]),
      enableSuccessMock('d1', 'u2', ['u1', 'u2']),
    ]);
    await waitForUserList(result);
    act(() => seedDeviceUsers(result.current!.client, [{ id: 'd1', enabledUserIds: ['u1'] }]));

    await act(() => result.current!.enable[0]('d1', 'bob'));

    const cached = result.current!.client.readQuery({ query: DeviceUsersDocument });
    expect(cached?.viewer.devices.find((d) => d.id === 'd1')?.enabledUsers).toEqual([
      { __typename: 'User', id: 'u1' },
      { __typename: 'User', id: 'u2' },
    ]);
  });

  it('returns false and sets an error when the username is not in the cached UserList', async () => {
    const result = renderEnableDeviceUser([userListMock([alice])]);
    await waitForUserList(result);

    const ok = await act(() => result.current!.enable[0]('d1', 'ghost'));
    expect(ok).toBe(false);
    expect(result.current!.enable[2]).toBe(true);
    expect(result.current!.enable[3]).toBe('Unknown user "ghost"');
  });

  it('surfaces an InvalidInputError message', async () => {
    const result = renderEnableDeviceUser([
      userListMock([alice]),
      invalidInputMock('d1', 'u1', 'deviceId must not be empty'),
    ]);
    await waitForUserList(result);

    const ok = await act(() => result.current!.enable[0]('d1', 'alice'));
    expect(ok).toBe(false);
    expect(result.current!.enable[2]).toBe(true);
    expect(result.current!.enable[3]).toBe('deviceId must not be empty');
  });

  // `deviceEnableUser` resolves null when the device or user no longer
  // exists — a distinct third case from a typed error, per `unwrapResult`'s
  // contract.
  it('reports a null result as a generic failure, not the server error branch', async () => {
    const result = renderEnableDeviceUser([userListMock([alice]), missingMock('d1', 'u1')]);
    await waitForUserList(result);

    const ok = await act(() => result.current!.enable[0]('d1', 'alice'));
    expect(ok).toBe(false);
    expect(result.current!.enable[2]).toBe(true);
    expect(result.current!.enable[3]).toBe('Failed to enable user');
  });
});

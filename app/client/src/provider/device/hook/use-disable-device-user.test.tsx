import type { ApolloClient } from '@apollo/client';
import { useApolloClient } from '@apollo/client/react';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeviceDisableUserDocument, DeviceUsersDocument } from '~/graphql/device';
import { UserListDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { useDisableDeviceUser, type UseDisableDeviceUser } from './use-disable-device-user';

const alice = { __typename: 'User' as const, id: 'u1', username: 'alice', progressCount: 0 };
const bob = { __typename: 'User' as const, id: 'u2', username: 'bob', progressCount: 0 };

const userListMock = (users: (typeof alice)[]) => ({
  request: { query: UserListDocument },
  result: {
    data: { __typename: 'Query' as const, viewer: { __typename: 'Viewer' as const, users } },
  },
});

const disableSuccessMock = (deviceId: string, userId: string, remainingUserIds: string[]) => ({
  request: { query: DeviceDisableUserDocument, variables: { input: { deviceId, userId } } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      deviceDisableUser: {
        __typename: 'DeviceDisableUserPayload' as const,
        device: {
          __typename: 'Device' as const,
          id: deviceId,
          enabledUsers: remainingUserIds.map((id) => ({ __typename: 'User' as const, id })),
        },
      },
    },
  },
});

const invalidInputMock = (deviceId: string, userId: string, message: string) => ({
  request: { query: DeviceDisableUserDocument, variables: { input: { deviceId, userId } } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      deviceDisableUser: { __typename: 'InvalidInputError' as const, message },
    },
  },
});

const missingMock = (deviceId: string, userId: string) => ({
  request: { query: DeviceDisableUserDocument, variables: { input: { deviceId, userId } } },
  result: { data: { __typename: 'Mutation' as const, deviceDisableUser: null } },
});

type Harness = { disable: UseDisableDeviceUser; client: ApolloClient };

const renderDisableDeviceUser = (
  mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']
) => {
  const result: { current?: Harness } = {};
  const Probe = () => {
    result.current = { disable: useDisableDeviceUser(), client: useApolloClient() };
    return null;
  };
  renderWithApollo(<Probe />, { mocks, user: { username: 'admin', isAdmin: true } });
  return result;
};

/** Mirrors `use-enable-device-user.test.tsx`'s identical helper: the
 * username→id lookup races the cached UserList read unless we wait for it
 * first. */
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

describe('useDisableDeviceUser', () => {
  it('returns a disable function and initial false/undefined state', () => {
    const result = renderDisableDeviceUser([userListMock([alice])]);
    const [disable, loading, error, errorMessage] = result.current!.disable;
    expect(typeof disable).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('resolves the username to a User global id and sends DeviceDisableUser, returning true', async () => {
    const result = renderDisableDeviceUser([
      userListMock([alice, bob]),
      disableSuccessMock('d1', 'u1', ['u2']),
    ]);
    await waitForUserList(result);

    const ok = await act(() => result.current!.disable[0]('d1', 'alice'));
    expect(ok).toBe(true);
  });

  /**
   * The task's real content: no `update` function is passed to this
   * mutation — `deviceDisableUser` returning `device { id enabledUsers { id
   * } }` outright normalizes over the existing `Device:d1` entity and
   * refreshes this cached read on its own.
   */
  it('updates a cached DeviceUsers read with no explicit update function', async () => {
    const result = renderDisableDeviceUser([
      userListMock([alice, bob]),
      disableSuccessMock('d1', 'u1', ['u2']),
    ]);
    await waitForUserList(result);
    act(() =>
      seedDeviceUsers(result.current!.client, [{ id: 'd1', enabledUserIds: ['u1', 'u2'] }])
    );

    await act(() => result.current!.disable[0]('d1', 'alice'));

    const cached = result.current!.client.readQuery({ query: DeviceUsersDocument });
    expect(cached?.viewer.devices.find((d) => d.id === 'd1')?.enabledUsers).toEqual([
      { __typename: 'User', id: 'u2' },
    ]);
  });

  it('returns false and sets an error when the username is not in the cached UserList', async () => {
    const result = renderDisableDeviceUser([userListMock([alice])]);
    await waitForUserList(result);

    const ok = await act(() => result.current!.disable[0]('d1', 'ghost'));
    expect(ok).toBe(false);
    expect(result.current!.disable[2]).toBe(true);
    expect(result.current!.disable[3]).toBe('Unknown user "ghost"');
  });

  it('surfaces an InvalidInputError message', async () => {
    const result = renderDisableDeviceUser([
      userListMock([alice]),
      invalidInputMock('d1', 'u1', 'deviceId must not be empty'),
    ]);
    await waitForUserList(result);

    const ok = await act(() => result.current!.disable[0]('d1', 'alice'));
    expect(ok).toBe(false);
    expect(result.current!.disable[2]).toBe(true);
    expect(result.current!.disable[3]).toBe('deviceId must not be empty');
  });

  // `deviceDisableUser` resolves null when the device or user no longer
  // exists — a distinct third case from a typed error, per `unwrapResult`'s
  // contract.
  it('reports a null result as a generic failure, not the server error branch', async () => {
    const result = renderDisableDeviceUser([userListMock([alice]), missingMock('d1', 'u1')]);
    await waitForUserList(result);

    const ok = await act(() => result.current!.disable[0]('d1', 'alice'));
    expect(ok).toBe(false);
    expect(result.current!.disable[2]).toBe(true);
    expect(result.current!.disable[3]).toBe('Failed to disable user');
  });
});

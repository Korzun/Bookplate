import type { ApolloClient } from '@apollo/client';
import { useApolloClient } from '@apollo/client/react';
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeviceUsersDocument } from '~/graphql/device';
import { UserListDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { useDeviceUsers, type UseDeviceUsers } from './use-device-users';

const user = (overrides: Record<string, unknown>) => ({
  __typename: 'User' as const,
  id: 'u1',
  username: 'alice',
  progressCount: 0,
  library: { __typename: 'Library' as const, id: 'lib-u1' },
  ...overrides,
});

const alice = user({ id: 'u1', username: 'alice' });
const bob = user({ id: 'u2', username: 'bob' });

const userListMock = (users: ReturnType<typeof user>[]) => ({
  request: { query: UserListDocument },
  result: {
    data: { __typename: 'Query' as const, viewer: { __typename: 'Viewer' as const, users } },
  },
});

const device = (id: string, enabledUserIds: string[] | null) => ({
  __typename: 'Device' as const,
  id,
  enabledUsers:
    enabledUserIds === null
      ? null
      : enabledUserIds.map((userId) => ({ __typename: 'User' as const, id: userId })),
});

const deviceUsersMock = (devices: ReturnType<typeof device>[]) => ({
  request: { query: DeviceUsersDocument },
  result: {
    data: { __typename: 'Query' as const, viewer: { __typename: 'Viewer' as const, devices } },
  },
});

const renderDeviceUsers = (
  deviceId: string | undefined,
  mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks'],
  isAdmin = true
) => {
  const result: { current?: UseDeviceUsers } = {};
  const Probe = () => {
    result.current = useDeviceUsers(deviceId);
    return null;
  };
  renderWithApollo(<Probe />, { mocks, user: { username: 'admin', isAdmin } });
  return result;
};

type Harness = { deviceUsers: UseDeviceUsers; client: ApolloClient };

const renderDeviceUsersWithClient = (
  deviceId: string | undefined,
  mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']
) => {
  const result: { current?: Harness } = {};
  const Probe = () => {
    result.current = { deviceUsers: useDeviceUsers(deviceId), client: useApolloClient() };
    return null;
  };
  renderWithApollo(<Probe />, { mocks, user: { username: 'admin', isAdmin: true } });
  return result;
};

describe('useDeviceUsers', () => {
  it('resolves the matching device’s enabled usernames against the cached UserList', async () => {
    const result = renderDeviceUsers('d1', [
      userListMock([alice, bob]),
      deviceUsersMock([device('d1', ['u1']), device('d2', ['u2'])]),
    ]);

    await waitFor(() => expect(result.current?.[1]).toBe(false));
    expect(result.current?.[2]).toBe(false);
    expect(result.current?.[3]).toBeUndefined();
    // d2's 'bob' must not leak into d1's read.
    expect(result.current?.[0]).toEqual(['alice']);
  });

  it('reports loading before the query resolves', () => {
    const result = renderDeviceUsers('d1', [
      userListMock([alice]),
      deviceUsersMock([device('d1', ['u1'])]),
    ]);

    expect(result.current?.[1]).toBe(true);
    expect(result.current?.[0]).toEqual([]);
  });

  it('performs no query and returns empty, non-loading state when no deviceId is given', () => {
    // Create mode: no device yet, nothing to fetch. No mocks at all — MockLink
    // would throw on any request, proving `skip` (not just an empty result)
    // is what's happening.
    const result = renderDeviceUsers(undefined, []);
    expect(result.current).toEqual([[], false, false, undefined]);
  });

  /**
   * `Device.enabledUsers` is admin-only and nullable, but the server's
   * test-pinned contract (`device/enabled-users.test.ts`, "refuses a
   * non-admin") always pairs a denial's `enabledUsers: null` with a
   * FORBIDDEN error in the same response — Apollo's default `errorPolicy:
   * 'none'` then discards `data` entirely, so that shape never reaches this
   * hook as "live data, null field". Querying at all is the thing to guard:
   * `skip: !isAdmin`, made real and explicit here rather than left dependent
   * on a caller passing `undefined` for a non-admin. No matching mock is
   * supplied for either document below — if `skip` were not in effect,
   * MockLink would have nothing to resolve either request with, and this
   * would come back as an error instead of this clean idle state.
   */
  it('does not issue the DeviceUsers query for a non-admin (skip), and reports neither loading nor an error', () => {
    const result = renderDeviceUsers('d1', [], false);

    expect(result.current?.[1]).toBe(false);
    expect(result.current?.[2]).toBe(false);
    expect(result.current?.[3]).toBeUndefined();
    expect(result.current?.[0]).toEqual([]);
  });

  it('surfaces a GraphQL error as hasError with a message, not an empty list', async () => {
    const result = renderDeviceUsers('d1', [
      userListMock([alice]),
      { request: { query: DeviceUsersDocument }, error: new Error('device users query failed') },
    ]);

    await waitFor(() => expect(result.current?.[2]).toBe(true));
    expect(result.current?.[3]).toBe('device users query failed');
    expect(result.current?.[0]).toEqual([]);
    expect(result.current?.[1]).toBe(false);
  });

  /**
   * Usernames are resolved by intersecting DeviceUsers ids against the
   * cached UserList (see this hook's doc comment), so this hook's loading
   * slot has to reflect BOTH queries. Sibling write-side hooks
   * (`use-enable-device-user`/`use-disable-device-user`) already guard the
   * identical race with a `waitForUserList` helper; this pins the same
   * property on the read side. Explicit, unequal delays remove the random
   * 20-50ms `MockLink` default so DeviceUsers is forced to resolve first,
   * deterministically — without folding UserList's loading in, the hook
   * would report a stable `[[], false, false, undefined]` in that window:
   * an authoritative-looking "no enabled users" for a device that in fact
   * has one, just not yet resolved against the username list.
   */
  it('keeps loading true — not an authoritative empty list — if DeviceUsers resolves before UserList', async () => {
    const result = renderDeviceUsersWithClient('d1', [
      { ...deviceUsersMock([device('d1', ['u1'])]), delay: 0 },
      { ...userListMock([alice]), delay: 300 },
    ]);

    // DeviceUsers has landed in the cache...
    await waitFor(() => {
      expect(result.current!.client.readQuery({ query: DeviceUsersDocument })).not.toBeNull();
    });
    // ...while UserList is still in flight.
    expect(result.current!.client.readQuery({ query: UserListDocument })).toBeNull();
    expect(result.current!.deviceUsers[1]).toBe(true);
    expect(result.current!.deviceUsers[0]).toEqual([]);

    await waitFor(() => expect(result.current!.deviceUsers[1]).toBe(false));
    expect(result.current!.deviceUsers[0]).toEqual(['alice']);
    expect(result.current!.deviceUsers[2]).toBe(false);
    expect(result.current!.deviceUsers[3]).toBeUndefined();
  });
});

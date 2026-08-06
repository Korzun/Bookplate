import type { MockedResponse } from '@apollo/client/testing';
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UserListDocument } from '~/graphql/user';
import { renderHookWithApollo } from '~/test-utils';

import { useUserList } from './use-user-list';

const user = (overrides: Record<string, unknown>) => ({
  __typename: 'User' as const,
  id: 'u1',
  username: 'alice',
  progressCount: 0,
  ...overrides,
});

const userListMock = (users: ReturnType<typeof user>[]) => ({
  request: { query: UserListDocument },
  result: {
    data: {
      __typename: 'Query' as const,
      viewer: {
        __typename: 'Viewer' as const,
        users,
      },
    },
  },
});

/**
 * Renders the hook inside renderHookWithApollo's provider stack. `isAdmin`
 * defaults to `true` here (renderWithApollo's OWN default is `isAdmin:
 * false`, which would `skip` every query below) since most of these tests
 * exercise the query itself; the dedicated non-admin test below overrides it
 * back to `false`.
 */
const renderUserList = (mocks: MockedResponse[], isAdmin = true) =>
  renderHookWithApollo(() => useUserList(), mocks, { user: { username: 'admin', isAdmin } }).result;

describe('useUserList', () => {
  it('returns users in username order with the tuple shape unchanged, id present', async () => {
    const result = renderUserList([
      userListMock([
        user({ id: 'u2', username: 'zara', progressCount: 3 }),
        user({ id: 'u1', username: 'alice', progressCount: 1 }),
      ]),
    ]);

    await waitFor(() => expect(result.current?.[1]).toBe(false));
    expect(result.current?.[2]).toBe(false);
    expect(result.current?.[3]).toBeUndefined();
    expect(result.current?.[0].map((u) => u.username)).toEqual(['alice', 'zara']);
    expect(result.current?.[0][0]).toEqual({ id: 'u1', username: 'alice', progressCount: 1 });
  });

  it('reports loading before the query resolves', () => {
    const result = renderUserList([userListMock([user({})])]);

    expect(result.current?.[1]).toBe(true);
    expect(result.current?.[0]).toEqual([]);
  });

  /**
   * Retired: "treats a null users field as an empty list, not an error".
   * That test asserted a shape the real server never produces — its
   * test-pinned contract (app/server/graphql/schema/viewer/users.test.ts)
   * always pairs a denial's `users: null` with a FORBIDDEN GraphQL error,
   * and Apollo's default errorPolicy discards `data` whenever an error is
   * present. So "null data, no error" only ever occurred here because the
   * mock supplied `null` with no `errors` array — an artifact of the test
   * double, not a real response. The two tests below cover what actually
   * happens instead: `skip` stopping the query before it is ever sent (this
   * hook's real defense for a non-admin), and a genuine GraphQL error taking
   * the error branch.
   */
  it('does not issue the query for a non-admin (skip), and reports neither loading nor an error', () => {
    // No matching mock is supplied. If `skip` were not in effect, MockLink
    // would have no response to resolve this request with, and the query
    // would come back as an error instead of this clean idle state.
    const result = renderUserList([], false);

    expect(result.current?.[1]).toBe(false);
    expect(result.current?.[2]).toBe(false);
    expect(result.current?.[3]).toBeUndefined();
    expect(result.current?.[0]).toEqual([]);
  });

  it('surfaces a GraphQL error as hasError with a message, not an empty list', async () => {
    // No `result`, an `error` instead: MockLink resolves this as a network
    // error on UserListDocument. An empty array here would render identically
    // to "no users exist", which the devices equivalent of this hook already
    // ruled unacceptable.
    const result = renderUserList([
      {
        request: { query: UserListDocument },
        error: new Error('user list query failed'),
      },
    ]);

    await waitFor(() => expect(result.current?.[2]).toBe(true));
    expect(result.current?.[3]).toBe('user list query failed');
    expect(result.current?.[0]).toEqual([]);
    expect(result.current?.[1]).toBe(false);
  });
});

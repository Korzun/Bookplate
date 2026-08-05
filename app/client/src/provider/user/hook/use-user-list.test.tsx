import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UserListDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { useUserList, type UseUserList } from './use-user-list';

const user = (overrides: Record<string, unknown>) => ({
  __typename: 'User' as const,
  id: 'u1',
  username: 'alice',
  progressCount: 0,
  ...overrides,
});

const userListMock = (users: ReturnType<typeof user>[] | null) => ({
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

/** Renders the hook inside renderWithApollo's provider stack. */
const renderUserList = (mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']) => {
  const result: { current?: UseUserList } = {};
  const Probe = () => {
    result.current = useUserList();
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

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

  it('treats a null users field (non-admin scope denial) as an empty list, not an error', async () => {
    const result = renderUserList([userListMock(null)]);

    await waitFor(() => expect(result.current?.[1]).toBe(false));
    expect(result.current?.[0]).toEqual([]);
    expect(result.current?.[2]).toBe(false);
    expect(result.current?.[3]).toBeUndefined();
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

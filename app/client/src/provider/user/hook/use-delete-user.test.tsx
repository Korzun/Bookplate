import type { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import { useApolloClient } from '@apollo/client/react';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UserDeleteDocument, UserListDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { useDeleteUser, type UseDeleteUser } from './use-delete-user';

const alice = {
  __typename: 'User' as const,
  id: 'u1',
  username: 'alice',
  progressCount: 2,
  library: { __typename: 'Library' as const, id: 'LIB-U1' },
};

const bob = {
  __typename: 'User' as const,
  id: 'u2',
  username: 'bob',
  progressCount: 0,
  library: { __typename: 'Library' as const, id: 'LIB-U2' },
};

const deleteSuccessMock = {
  request: { query: UserDeleteDocument, variables: { input: { userId: 'u1' } } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      userDelete: { __typename: 'UserDeletePayload' as const, deletedId: 'u1' },
    },
  },
};

type Harness = { deleteUser: UseDeleteUser; client: ApolloClient };

const renderDeleteUser = (mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']) => {
  const result: { current?: Harness } = {};
  const Probe = () => {
    result.current = { deleteUser: useDeleteUser(), client: useApolloClient() };
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

const seedUserList = (client: ApolloClient, users: (typeof alice)[]) =>
  client.writeQuery({
    query: UserListDocument,
    data: { __typename: 'Query', viewer: { __typename: 'Viewer', users } },
  });

describe('useDeleteUser', () => {
  it('returns a deleteUser function and initial false/undefined state', () => {
    const result = renderDeleteUser([]);
    const [deleteUser, loading, error, errorMessage] = result.current!.deleteUser;
    expect(typeof deleteUser).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  // The task's real content: `userDelete` returns only `deletedId`, which
  // does not remove itself from any list — this proves the `cache.evict`
  // call actually ran, by reading the cache directly rather than re-mocking
  // UserList. No optimistic response exists for this mutation, so this only
  // takes effect once the real response lands (unlike `useDeleteDevice`).
  it('evicts the deleted user so a subsequent UserList cache read no longer includes it', async () => {
    const result = renderDeleteUser([deleteSuccessMock]);
    const { client } = result.current!;
    act(() => seedUserList(client, [alice, bob]));

    await act(() => result.current!.deleteUser[0]('u1'));

    const cached = client.readQuery({ query: UserListDocument });
    expect(cached?.viewer.users).toEqual([bob]);
    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(Object.keys(extracted)).not.toContain('User:u1');
  });

  it('sets error and message on a missing (null) userDelete result', async () => {
    const result = renderDeleteUser([
      {
        request: { query: UserDeleteDocument, variables: { input: { userId: 'u1' } } },
        result: { data: { __typename: 'Mutation' as const, userDelete: null } },
      },
    ]);
    act(() => seedUserList(result.current!.client, [alice]));

    await act(() => result.current!.deleteUser[0]('u1'));
    expect(result.current!.deleteUser[2]).toBe(true);
    expect(result.current!.deleteUser[3]).toBe('Failed to delete user');

    const cached = result.current!.client.readQuery({ query: UserListDocument });
    expect(cached?.viewer.users).toEqual([alice]);
  });

  it('sets error and message when the mutation throws', async () => {
    const result = renderDeleteUser([
      {
        request: { query: UserDeleteDocument, variables: { input: { userId: 'u1' } } },
        error: new Error('Network error'),
      },
    ]);
    act(() => seedUserList(result.current!.client, [alice]));

    await act(() => result.current!.deleteUser[0]('u1'));
    expect(result.current!.deleteUser[2]).toBe(true);
    expect(result.current!.deleteUser[3]).toBe('Network error');
  });

  it('sets loading to true while the mutation is pending', async () => {
    const result = renderDeleteUser([{ ...deleteSuccessMock, delay: 20 }]);
    act(() => seedUserList(result.current!.client, [alice]));

    act(() => {
      void result.current!.deleteUser[0]('u1');
    });
    await waitFor(() => expect(result.current!.deleteUser[1]).toBe(true));
    await waitFor(() => expect(result.current!.deleteUser[1]).toBe(false));
  });
});

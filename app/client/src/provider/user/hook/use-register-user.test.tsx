import type { ApolloClient } from '@apollo/client';
import { useApolloClient } from '@apollo/client/react';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UserListDocument, UserRegisterDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { useRegisterUser, type UseRegisterUser } from './use-register-user';

const registeredUser = {
  __typename: 'User' as const,
  id: 'u1',
  username: 'alicia',
  progressCount: 0,
};

const registerSuccessMock = {
  request: { query: UserRegisterDocument, variables: { input: { username: 'alicia' } } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      userRegister: {
        __typename: 'UserRegisterPayload' as const,
        user: registeredUser,
        password: 'generatedPass123',
      },
    },
  },
};

const conflictMock = {
  request: { query: UserRegisterDocument, variables: { input: { username: 'alicia' } } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      userRegister: {
        __typename: 'UsernameAlreadyExistsError' as const,
        message: 'Username already exists',
      },
    },
  },
};

type Harness = { register: UseRegisterUser; client: ApolloClient };

const renderRegisterUser = (
  mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']
) => {
  const result: { current?: Harness } = {};
  const Probe = () => {
    result.current = { register: useRegisterUser(), client: useApolloClient() };
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

/** Seeds an empty `UserList` read, mirroring the cache state before any user
 * exists — the append's starting point. */
const seedEmptyUserList = (client: ApolloClient) =>
  client.writeQuery({
    query: UserListDocument,
    data: { __typename: 'Query', viewer: { __typename: 'Viewer', users: [] } },
  });

describe('useRegisterUser', () => {
  it('returns registerUser function and initial false/undefined state', () => {
    const result = renderRegisterUser([]);
    const [registerUser, loading, error, errorMessage] = result.current!.register;
    expect(typeof registerUser).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('sends the UserRegister mutation and returns the generated password', async () => {
    const result = renderRegisterUser([registerSuccessMock]);
    act(() => seedEmptyUserList(result.current!.client));

    const password = await act(() => result.current!.register[0]('alicia'));
    expect(password).toBe('generatedPass123');
  });

  // The task's real content: a returned entity does not insert itself into a
  // list, so this proves the `cache.modify` append actually ran, by reading
  // the cache directly rather than re-mocking UserList.
  it('appends the registered user to a subsequent UserList cache read', async () => {
    const result = renderRegisterUser([registerSuccessMock]);
    act(() => seedEmptyUserList(result.current!.client));

    await act(() => result.current!.register[0]('alicia'));

    const cached = result.current!.client.readQuery({ query: UserListDocument });
    expect(cached?.viewer.users).toEqual([registeredUser]);
  });

  it('surfaces a UsernameAlreadyExistsError message and does not append anything', async () => {
    const result = renderRegisterUser([conflictMock]);
    act(() => seedEmptyUserList(result.current!.client));

    const password = await act(() => result.current!.register[0]('alicia'));
    expect(password).toBeNull();
    expect(result.current!.register[2]).toBe(true);
    expect(result.current!.register[3]).toBe('Username already exists');

    const cached = result.current!.client.readQuery({ query: UserListDocument });
    expect(cached?.viewer.users).toEqual([]);
  });

  it('sets loading to true while the mutation is pending', async () => {
    const result = renderRegisterUser([{ ...registerSuccessMock, delay: 20 }]);
    act(() => seedEmptyUserList(result.current!.client));

    act(() => {
      void result.current!.register[0]('alicia');
    });
    await waitFor(() => expect(result.current!.register[1]).toBe(true));
    await waitFor(() => expect(result.current!.register[1]).toBe(false));
  });
});

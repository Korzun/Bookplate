import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UserResetPasswordDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { useResetUserPassword, type UseResetUserPassword } from './use-reset-user-password';

const resetSuccessMock = {
  request: { query: UserResetPasswordDocument, variables: { input: { userId: 'u1' } } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      userResetPassword: {
        __typename: 'UserResetPasswordPayload' as const,
        user: { __typename: 'User' as const, id: 'u1' },
        password: 'k4tWc9pLxQ2mAbCd',
      },
    },
  },
};

const renderResetUserPassword = (
  mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']
) => {
  const result: { current?: UseResetUserPassword } = {};
  const Probe = () => {
    result.current = useResetUserPassword();
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

describe('useResetUserPassword', () => {
  it('returns resetUserPassword function and initial false/undefined state', () => {
    const result = renderResetUserPassword([]);
    const [resetUserPassword, loading, error, errorMessage] = result.current!;
    expect(typeof resetUserPassword).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('sends the UserResetPassword mutation and returns the new password', async () => {
    const result = renderResetUserPassword([resetSuccessMock]);

    const password = await act(() => result.current![0]('u1'));
    expect(password).toBe('k4tWc9pLxQ2mAbCd');
    expect(result.current![1]).toBe(false);
    expect(result.current![2]).toBe(false);
  });

  it('sets error and returns null on a missing (null) userResetPassword result', async () => {
    const result = renderResetUserPassword([
      {
        request: { query: UserResetPasswordDocument, variables: { input: { userId: 'nobody' } } },
        result: { data: { __typename: 'Mutation' as const, userResetPassword: null } },
      },
    ]);

    const password = await act(() => result.current![0]('nobody'));
    expect(password).toBeNull();
    expect(result.current![2]).toBe(true);
    expect(result.current![3]).toBe('Failed to reset password');
  });

  it('sets error and returns null when the mutation throws', async () => {
    const result = renderResetUserPassword([
      {
        request: { query: UserResetPasswordDocument, variables: { input: { userId: 'u1' } } },
        error: new Error('Network error'),
      },
    ]);

    const password = await act(() => result.current![0]('u1'));
    expect(password).toBeNull();
    expect(result.current![2]).toBe(true);
    expect(result.current![3]).toBe('Network error');
  });

  it('sets loading true while the mutation is pending', async () => {
    const result = renderResetUserPassword([{ ...resetSuccessMock, delay: 20 }]);

    act(() => {
      void result.current![0]('u1');
    });
    await waitFor(() => expect(result.current![1]).toBe(true));
    await waitFor(() => expect(result.current![1]).toBe(false));
  });
});

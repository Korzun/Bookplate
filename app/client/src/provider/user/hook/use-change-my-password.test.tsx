import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserChangePasswordDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { useChangeMyPassword, type UseChangeMyPassword } from './use-change-my-password';

const successMock = {
  request: {
    query: UserChangePasswordDocument,
    variables: { input: { currentPassword: 'oldpass', newPassword: 'newpass' } },
  },
  result: {
    data: {
      __typename: 'Mutation' as const,
      userChangePassword: {
        __typename: 'UserChangePasswordPayload' as const,
        user: { __typename: 'User' as const, id: 'u1' },
      },
    },
  },
};

const incorrectPasswordMock = {
  request: {
    query: UserChangePasswordDocument,
    variables: { input: { currentPassword: 'wrongpass', newPassword: 'newpass' } },
  },
  result: {
    data: {
      __typename: 'Mutation' as const,
      userChangePassword: {
        __typename: 'IncorrectPasswordError' as const,
        message: 'Current password is incorrect',
      },
    },
  },
};

const invalidInputMock = {
  request: {
    query: UserChangePasswordDocument,
    variables: { input: { currentPassword: '', newPassword: 'newpass' } },
  },
  result: {
    data: {
      __typename: 'Mutation' as const,
      userChangePassword: { __typename: 'InvalidInputError' as const, message: 'Invalid input' },
    },
  },
};

const renderChangeMyPassword = (
  mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']
) => {
  const result: { current?: UseChangeMyPassword } = {};
  const Probe = () => {
    result.current = useChangeMyPassword();
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

describe('useChangeMyPassword', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('returns changeMyPassword function and initial false/undefined state', () => {
    const result = renderChangeMyPassword([]);
    const [changeMyPassword, loading, okay, error, errorMessage] = result.current!;
    expect(typeof changeMyPassword).toBe('function');
    expect(loading).toBe(false);
    expect(okay).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  // The task's real content: a successful change must never leave the caller
  // in a continuing session — the server has already revoked its refresh
  // tokens as the mutation's own side effect. Success means log out (best-
  // effort cookie cleanup + unconditional local clear) and navigate away.
  it('on success, clears the token and navigates to /login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    localStorage.setItem('accessToken', 'stale-token');
    const result = renderChangeMyPassword([successMock]);

    const ok = await act(() => result.current![0]('oldpass', 'newpass'));

    expect(ok).toBe(true);
    expect(result.current![2]).toBe(true); // okay
    expect(result.current![3]).toBe(false); // error
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(window.location.href).toBe('/login');
  });

  // The hazard the brief calls out by name: the best-effort POST failing must
  // not leave the caller stuck in a session whose refresh tokens are already
  // dead server-side. The local half of the contract holds regardless.
  it('on success, still clears the token and navigates to /login when the best-effort logout POST fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    localStorage.setItem('accessToken', 'stale-token');
    const result = renderChangeMyPassword([successMock]);

    const ok = await act(() => result.current![0]('oldpass', 'newpass'));

    expect(ok).toBe(true);
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(window.location.href).toBe('/login');
  });

  // A distinct domain outcome from a validation issue: the input was
  // well-formed, the password was simply wrong. This must not log the caller
  // out — their existing session and refresh tokens are untouched server-side.
  it('surfaces IncorrectPasswordError and does not log out', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const result = renderChangeMyPassword([incorrectPasswordMock]);

    const ok = await act(() => result.current![0]('wrongpass', 'newpass'));

    expect(ok).toBe(false);
    expect(result.current![2]).toBe(false); // okay
    expect(result.current![3]).toBe(true); // error
    expect(result.current![4]).toBe('Current password is incorrect');
    expect(fetch).not.toHaveBeenCalled();
    expect(window.location.href).toBe('');
  });

  it('surfaces InvalidInputError as a flat message and does not log out', async () => {
    const result = renderChangeMyPassword([invalidInputMock]);

    const ok = await act(() => result.current![0]('', 'newpass'));

    expect(ok).toBe(false);
    expect(result.current![3]).toBe(true);
    expect(result.current![4]).toBe('Invalid input');
    expect(window.location.href).toBe('');
  });

  it('sets a generic error and returns false on a missing (null) mutation result', async () => {
    const result = renderChangeMyPassword([
      {
        request: {
          query: UserChangePasswordDocument,
          variables: { input: { currentPassword: 'oldpass', newPassword: 'newpass' } },
        },
        result: { data: { __typename: 'Mutation' as const, userChangePassword: null } },
      },
    ]);

    const ok = await act(() => result.current![0]('oldpass', 'newpass'));

    expect(ok).toBe(false);
    expect(result.current![3]).toBe(true);
    expect(result.current![4]).toBe('Password change failed');
    expect(window.location.href).toBe('');
  });

  it('sets error and returns false when the mutation throws', async () => {
    const result = renderChangeMyPassword([
      {
        request: {
          query: UserChangePasswordDocument,
          variables: { input: { currentPassword: 'oldpass', newPassword: 'newpass' } },
        },
        error: new Error('Network error'),
      },
    ]);

    const ok = await act(() => result.current![0]('oldpass', 'newpass'));

    expect(ok).toBe(false);
    expect(result.current![3]).toBe(true);
    expect(result.current![4]).toBe('Network error');
  });

  it('sets loading to true while the mutation is pending', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const result = renderChangeMyPassword([{ ...successMock, delay: 20 }]);

    act(() => {
      void result.current![0]('oldpass', 'newpass');
    });
    await waitFor(() => expect(result.current![1]).toBe(true));
    await waitFor(() => expect(result.current![1]).toBe(false));
  });

  // The forced-reset-viewer path this hook exists to unblock (every `Query`
  // field is gated on `authenticated`, which is false for a
  // `mustChangePassword` viewer) is now covered by a stronger test:
  // `page/password-reset/index.integration.test.tsx` renders the REAL
  // `PasswordResetPage` over this REAL hook with ONLY the
  // `UserChangePassword` mutation mock in scope — no module mock standing in
  // for `~/provider/user`, so it fails the moment the page or this hook
  // grows an unsatisfied query dependency. A hook-level test with the same
  // `[successMock]` mock array as "on success, clears the token and
  // navigates to /login" above would only ever assert a strict subset of
  // that test's assertions and could never fail on its own — this hook has
  // no `useQuery` for such a test to actually discriminate against.
});

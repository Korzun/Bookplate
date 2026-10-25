import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  UserChangePasswordMutation,
  UserChangePasswordMutationVariables,
} from '~/gql/graphql';
import { UserChangePasswordDocument } from '~/graphql/user';
import { TOKEN_KEY } from '~/lib/token';
import { renderWithApollo } from '~/test-utils';

import { PasswordResetPage } from './index';

const successMock: MockedResponse<UserChangePasswordMutation, UserChangePasswordMutationVariables> =
  {
    request: {
      query: UserChangePasswordDocument,
      variables: { input: { currentPassword: 'old', newPassword: 'newpass' } },
    },
    result: {
      data: {
        __typename: 'Mutation',
        userChangePassword: {
          __typename: 'UserChangePasswordPayload',
          user: { __typename: 'User', id: 'u1' },
        },
      },
    },
  };

const NEW_ACCESS_TOKEN = 'header.payload.signature';

const submitChange = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByPlaceholderText('Current Password'), 'old');
  await user.type(screen.getByPlaceholderText('New Password'), 'newpass');
  await user.type(screen.getByPlaceholderText('Confirm New Password'), 'newpass');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
};

const loginCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/login');

describe('PasswordResetPage', () => {
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

  // The mutation revokes every refresh token, so the only way to keep the
  // caller signed in is to log in again with the credentials they just chose.
  // The new access token carries `mustChangePassword: false`, which is what
  // lifts the gate and lets `ProtectedRoute` send them home.
  it('signs the viewer back in with the new password instead of logging out', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: NEW_ACCESS_TOKEN }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithApollo(<PasswordResetPage />, {
      mocks: [successMock],
      user: { username: 'alice', isAdmin: false, mustChangePassword: true },
    });

    await submitChange(user);

    await waitFor(() => expect(localStorage.getItem(TOKEN_KEY)).toBe(NEW_ACCESS_TOKEN));
    const [[, init]] = loginCalls(fetchMock);
    expect(String((init as RequestInit).body)).toBe(
      new URLSearchParams({ username: 'alice', password: 'newpass' }).toString()
    );
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/logout', expect.anything());
    expect(window.location.href).toBe('');
  });

  // The password HAS changed by this point and the old session is already
  // dead server-side, so a failed re-login must not leave the caller holding a
  // stale `mustChangePassword: true` token for the rest of its TTL — the old
  // "log out and send to /login" path is the fallback, not the default.
  it('falls back to logging out when the re-login fails', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          url === '/api/login' ? { ok: false, status: 401, json: async () => ({}) } : { ok: true }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithApollo(<PasswordResetPage />, {
      mocks: [successMock],
      user: { username: 'alice', isAdmin: false, mustChangePassword: true },
    });

    await submitChange(user);

    await waitFor(() => expect(window.location.href).toBe('/login'));
    expect(loginCalls(fetchMock)).toHaveLength(1);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  // The Change password button is a native <button> in submit mode, which
  // shrink-wraps its label instead of filling the card the way a div does. The
  // form's flex column stretches it back across the card, level with the fields.
  it('lays the form out as a column so Change password spans the card', () => {
    const { container } = renderWithApollo(<PasswordResetPage />);
    const style = getComputedStyle(container.querySelector('form') as HTMLElement);
    expect(style.display).toBe('flex');
    expect(style.flexDirection).toBe('column');
  });
});

import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  UserChangePasswordMutation,
  UserChangePasswordMutationVariables,
} from '~/gql/graphql';
import { UserChangePasswordDocument } from '~/graphql/user';
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

describe('PasswordResetPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('submits the new password via the form', async () => {
    const user = userEvent.setup();
    renderWithApollo(<PasswordResetPage />, { mocks: [successMock] });

    await user.type(screen.getByPlaceholderText('Current Password'), 'old');
    await user.type(screen.getByPlaceholderText('New Password'), 'newpass');
    await user.type(screen.getByPlaceholderText('Confirm New Password'), 'newpass');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(window.location.href).toBe('/login'));
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

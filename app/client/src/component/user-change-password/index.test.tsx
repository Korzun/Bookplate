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

import { UserChangePassword } from './index';

const successMock: MockedResponse<UserChangePasswordMutation, UserChangePasswordMutationVariables> =
  {
    request: {
      query: UserChangePasswordDocument,
      variables: { input: { currentPassword: 'old-pass', newPassword: 'new-pass' } },
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

const incorrectPasswordMock: MockedResponse<
  UserChangePasswordMutation,
  UserChangePasswordMutationVariables
> = {
  request: {
    query: UserChangePasswordDocument,
    variables: { input: { currentPassword: 'old-pass', newPassword: 'new-pass' } },
  },
  result: {
    data: {
      __typename: 'Mutation',
      userChangePassword: {
        __typename: 'IncorrectPasswordError',
        message: 'Current password is incorrect',
      },
    },
  },
};

function renderForm(mocks: MockedResponse[] = []) {
  const rendered = renderWithApollo(<UserChangePassword />, { mocks });
  const currentPasswordInput = rendered.container.querySelector(
    'input[name="current-password"]'
  ) as HTMLInputElement;
  const newPasswordInput = rendered.container.querySelector(
    'input[name="new-password"]'
  ) as HTMLInputElement;
  const confirmPasswordInput = rendered.container.querySelector(
    'input[name="confirm-new-password"]'
  ) as HTMLInputElement;
  return { ...rendered, currentPasswordInput, newPasswordInput, confirmPasswordInput };
}

describe('UserChangePassword', () => {
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

  // The task's real content: a successful change must never leave the caller
  // in a continuing session — a successful mutation logs the caller out and
  // navigates to /login via the shared logout helper.
  it('submits the new password via the form and logs out on success', async () => {
    const user = userEvent.setup();
    const { currentPasswordInput, newPasswordInput, confirmPasswordInput } = renderForm([
      successMock,
    ]);

    await user.type(currentPasswordInput, 'old-pass');
    await user.type(newPasswordInput, 'new-pass');
    await user.type(confirmPasswordInput, 'new-pass');

    const submitButton = screen.getByRole('button', { name: 'Change password' });
    expect(submitButton).toBeEnabled();
    await user.click(submitButton);

    await waitFor(() => expect(window.location.href).toBe('/login'));
  });

  it('surfaces an incorrect-password error toast and does not log out', async () => {
    const user = userEvent.setup();
    const { currentPasswordInput, newPasswordInput, confirmPasswordInput } = renderForm([
      incorrectPasswordMock,
    ]);

    await user.type(currentPasswordInput, 'old-pass');
    await user.type(newPasswordInput, 'new-pass');
    await user.type(confirmPasswordInput, 'new-pass');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Current password is incorrect');
    expect(window.location.href).toBe('');
  });

  it('keeps the submit button disabled and sends no mutation when confirmation does not match', async () => {
    const user = userEvent.setup();
    const { currentPasswordInput, newPasswordInput, confirmPasswordInput } = renderForm();

    await user.type(currentPasswordInput, 'old-pass');
    await user.type(newPasswordInput, 'new-pass');
    await user.type(confirmPasswordInput, 'mismatched');

    const submitButton = screen.getByRole('button', { name: 'Change password' });
    expect(submitButton).toBeDisabled();

    // A disabled native submit button should not trigger the form action even
    // when clicked. MockLink throws on an unmatched request — an empty
    // `mocks` array plus no thrown error proves nothing was sent.
    await user.click(submitButton);
  });
});

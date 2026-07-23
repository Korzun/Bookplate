import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

const changeMyPassword = vi.fn(async () => true);
vi.mock('~/provider/user', () => ({
  useChangeMyPassword: () => [changeMyPassword, false] as const,
}));

import { UserChangePassword } from './index';

function renderForm() {
  const rendered = renderWithProviders(<UserChangePassword />);
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
    changeMyPassword.mockClear();
  });

  it('submits the new password via the form when confirmation matches', async () => {
    const user = userEvent.setup();
    const { currentPasswordInput, newPasswordInput, confirmPasswordInput } = renderForm();

    await user.type(currentPasswordInput, 'old-pass');
    await user.type(newPasswordInput, 'new-pass');
    await user.type(confirmPasswordInput, 'new-pass');

    const submitButton = screen.getByRole('button', { name: 'Change password' });
    expect(submitButton).toBeEnabled();
    await user.click(submitButton);

    await waitFor(() => expect(changeMyPassword).toHaveBeenCalledWith('old-pass', 'new-pass'));
  });

  it('keeps the submit button disabled and does not call the hook when confirmation does not match', async () => {
    const user = userEvent.setup();
    const { currentPasswordInput, newPasswordInput, confirmPasswordInput } = renderForm();

    await user.type(currentPasswordInput, 'old-pass');
    await user.type(newPasswordInput, 'new-pass');
    await user.type(confirmPasswordInput, 'mismatched');

    const submitButton = screen.getByRole('button', { name: 'Change password' });
    expect(submitButton).toBeDisabled();

    // A disabled native submit button should not trigger the form action even
    // when clicked.
    await user.click(submitButton);
    expect(changeMyPassword).not.toHaveBeenCalled();
  });
});

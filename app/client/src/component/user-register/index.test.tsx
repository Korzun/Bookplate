import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

const registerUser = vi.fn(async (): Promise<string | null> => 'newpassword');
vi.mock('~/provider/user', () => ({
  useRegisterUser: () => [registerUser, false] as const,
}));

import { UserRegister } from './index';

describe('UserRegister', () => {
  beforeEach(() => {
    registerUser.mockClear();
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it('registers via the form and shows the password result', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<UserRegister />);
    const usernameInput = container.querySelector('input[name="username"]') as HTMLInputElement;

    await user.type(usernameInput, 'bob');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(registerUser).toHaveBeenCalledWith('bob'));
    await waitFor(() => expect(screen.getByText('newpassword')).toBeInTheDocument());
  });

  it('surfaces the failure toast and does not open the modal when registration fails', async () => {
    const user = userEvent.setup();
    // Faithful to the original: an empty submit still calls registerUser(''),
    // the hook resolves null, and the component shows the failure toast without
    // opening the PasswordResultModal.
    registerUser.mockResolvedValueOnce(null);
    renderWithProviders(<UserRegister />);

    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(registerUser).toHaveBeenCalledWith(''));
    expect(await screen.findByText('Registration failed')).toBeInTheDocument();
    // The password result modal never opens: no generated password is rendered.
    expect(screen.queryByText('newpassword')).not.toBeInTheDocument();
  });
});

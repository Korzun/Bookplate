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

  it('renders the card titled "Register a user"', () => {
    renderWithProviders(<UserRegister />);
    expect(screen.getByText('Register a user')).toBeInTheDocument();
  });

  it('keeps Register disabled until the username has at least 6 characters', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<UserRegister />);
    const usernameInput = container.querySelector('input[name="username"]') as HTMLInputElement;
    const button = screen.getByRole('button', { name: 'Register' });

    expect(button).toBeDisabled();
    await user.type(usernameInput, 'abc');
    expect(button).toBeDisabled();
    await user.type(usernameInput, 'def'); // now "abcdef" (6 chars)
    expect(button).toBeEnabled();
  });

  it('registers via the form and shows the password result', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<UserRegister />);
    const usernameInput = container.querySelector('input[name="username"]') as HTMLInputElement;

    await user.type(usernameInput, 'bobuser');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(registerUser).toHaveBeenCalledWith('bobuser'));
    await waitFor(() => expect(screen.getByText('newpassword')).toBeInTheDocument());
  });

  it('surfaces the failure toast and does not open the modal when registration fails', async () => {
    const user = userEvent.setup();
    registerUser.mockResolvedValueOnce(null);
    const { container } = renderWithProviders(<UserRegister />);
    const usernameInput = container.querySelector('input[name="username"]') as HTMLInputElement;

    await user.type(usernameInput, 'baduser');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(registerUser).toHaveBeenCalledWith('baduser'));
    expect(await screen.findByText('Registration failed')).toBeInTheDocument();
    expect(screen.queryByText('newpassword')).not.toBeInTheDocument();
  });

  // The Register button is a native <button> in submit mode, which shrink-wraps
  // its label instead of filling the card the way a div does. The form's flex
  // column is what stretches it back across the card, level with the field.
  it('lays the form out as a column so Register spans the card', () => {
    const { container } = renderWithProviders(<UserRegister />);
    const style = getComputedStyle(container.querySelector('form') as HTMLElement);
    expect(style.display).toBe('flex');
    expect(style.flexDirection).toBe('column');
  });
});

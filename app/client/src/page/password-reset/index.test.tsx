import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

const changeMyPassword = vi.fn(async () => true);
vi.mock('~/provider/user', () => ({
  useChangeMyPassword: () => [changeMyPassword, false] as const,
}));

import { PasswordResetPage } from './index';

describe('PasswordResetPage', () => {
  it('submits the new password via the form', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PasswordResetPage />);

    await user.type(screen.getByPlaceholderText('Current Password'), 'old');
    await user.type(screen.getByPlaceholderText('New Password'), 'newpass');
    await user.type(screen.getByPlaceholderText('Confirm New Password'), 'newpass');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(changeMyPassword).toHaveBeenCalledWith('old', 'newpass'));
  });

  // The Change password button is a native <button> in submit mode, which
  // shrink-wraps its label instead of filling the card the way a div does. The
  // form's flex column stretches it back across the card, level with the fields.
  it('lays the form out as a column so Change password spans the card', () => {
    const { container } = renderWithProviders(<PasswordResetPage />);
    const style = getComputedStyle(container.querySelector('form') as HTMLElement);
    expect(style.display).toBe('flex');
    expect(style.flexDirection).toBe('column');
  });
});

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
});

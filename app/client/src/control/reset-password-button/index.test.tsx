import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { renderWithProviders } from '~/test-utils';

import { ResetPasswordButton } from './index';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ResetPasswordButton', () => {
  it('shows a confirm modal, then reveals the new password on confirm', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200,
      json: async () => ({ password: 'k4tWc9pLxQ2mAbCd' }),
    } as Response);
    const user = userEvent.setup();

    renderWithProviders(<ResetPasswordButton username="alice" />);

    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(screen.getByText(/Reset password for/)).toBeInTheDocument();

    // Both the trigger button and the modal's confirm button are labeled
    // "Reset password" — the confirm button is the last one in document order.
    const resetButtons = screen.getAllByRole('button', { name: 'Reset password', hidden: true });
    await user.click(resetButtons[resetButtons.length - 1]);

    await waitFor(() =>
      expect(
        screen.getByText((_, el) => el?.textContent === 'k4tWc9pLxQ2mAbCd')
      ).toBeInTheDocument()
    );
    expect(fetch).toHaveBeenCalledWith('/api/users/alice/reset-password', { method: 'POST' });
  });

  it('shows an error toast when the reset fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ status: 404 } as Response);
    const user = userEvent.setup();

    renderWithProviders(<ResetPasswordButton username="alice" />);

    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    const resetButtons = screen.getAllByRole('button', { name: 'Reset password', hidden: true });
    await user.click(resetButtons[resetButtons.length - 1]);

    await waitFor(() => expect(screen.getByText(/Failed to reset password/)).toBeInTheDocument());
  });
});

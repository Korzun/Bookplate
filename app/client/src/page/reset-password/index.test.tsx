import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ResetPasswordPage } from './index';

describe('ResetPasswordPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('submits the address, code and new password, then sends the user to log in', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ResetPasswordPage />);

    await user.type(screen.getByPlaceholderText('Email address'), 'ann@example.com');
    await user.type(screen.getByPlaceholderText('Reset code'), 'K7M2QX4P');
    await user.type(screen.getByPlaceholderText('New password'), 'a-brand-new-password');
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'a-brand-new-password');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      email: 'ann@example.com',
      code: 'K7M2QX4P',
      newPassword: 'a-brand-new-password',
    });
    expect(await screen.findByText(/password reset/i)).toBeInTheDocument();
  });

  it('will not submit when the two passwords differ', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ResetPasswordPage />);
    await user.type(screen.getByPlaceholderText('Email address'), 'ann@example.com');
    await user.type(screen.getByPlaceholderText('Reset code'), 'K7M2QX4P');
    await user.type(screen.getByPlaceholderText('New password'), 'a-brand-new-password');
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'different-password');
    await user.click(screen.getByRole('button', { name: /reset password/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefills the code from ?code=', () => {
    renderWithProviders(<ResetPasswordPage />, {
      initialEntries: ['/reset-password?code=K7M2QX4P'],
    });
    expect(screen.getByDisplayValue('K7M2QX4P')).toBeInTheDocument();
  });

  it('shows one message for every rejected code', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'That reset code is not valid or has expired.' }),
      })
    );
    renderWithProviders(<ResetPasswordPage />);
    await user.type(screen.getByPlaceholderText('Email address'), 'ann@example.com');
    await user.type(screen.getByPlaceholderText('Reset code'), 'WRONGONE');
    await user.type(screen.getByPlaceholderText('New password'), 'a-brand-new-password');
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'a-brand-new-password');
    await user.click(screen.getByRole('button', { name: /reset password/i }));
    expect(await screen.findByText(/not valid or has expired/i)).toBeInTheDocument();
  });

  it('shows a mail-not-configured message on 404 rather than blaming the code', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    renderWithProviders(<ResetPasswordPage />);
    await user.type(screen.getByPlaceholderText('Email address'), 'ann@example.com');
    await user.type(screen.getByPlaceholderText('Reset code'), 'K7M2QX4P');
    await user.type(screen.getByPlaceholderText('New password'), 'a-brand-new-password');
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'a-brand-new-password');
    await user.click(screen.getByRole('button', { name: /reset password/i }));
    expect(await screen.findByText(/not configured on this server/i)).toBeInTheDocument();
  });
});

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ResetPasswordPage } from './index';

const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => routerMocks.navigate,
}));

describe('ResetPasswordPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    routerMocks.navigate.mockReset();
  });

  // The earlier copy here named the add-on configuration as the place the
  // administrator's password is set. That tells an anonymous visitor how this
  // install is deployed and that such an account exists, so the screen no
  // longer says it — the address it refuses is the only signal left.
  it('does not disclose where the administrator password is configured', () => {
    renderWithProviders(<ResetPasswordPage />);
    expect(screen.queryByText(/add-on configuration/i)).toBeNull();
  });

  it('offers a back-to-sign-in button below the card', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResetPasswordPage />);

    const button = screen.getByRole('button', { name: /back to sign in/i });
    expect(button.closest('form')).toBeNull();
    await user.click(button);
    expect(routerMocks.navigate).toHaveBeenCalledWith('/login');
  });

  // The card is sized by its fields, exactly as the login card is, so the two
  // screens do not visibly resize as the user moves between them.
  it('sizes the card to the same width as the login card', () => {
    const { container } = renderWithProviders(<ResetPasswordPage />);
    // The width sits on the block wrapping the form, not the form itself, so
    // the card keeps it once the form is replaced by a confirmation.
    const content = (container.querySelector('form') as HTMLElement).parentElement as HTMLElement;
    expect(getComputedStyle(content).minWidth).toBe('400px');
  });

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
    // The card's own "Go to sign in" link is gone: the bottom button already
    // says it, and two controls for one action read as two different actions.
    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull();
    expect(screen.getByRole('button', { name: /back to sign in/i })).toBeInTheDocument();
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

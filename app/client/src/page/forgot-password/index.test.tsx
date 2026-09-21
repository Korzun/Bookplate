import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ForgotPasswordPage } from './index';

const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => routerMocks.navigate,
}));

describe('ForgotPasswordPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    routerMocks.navigate.mockReset();
  });

  it('reports the same message whether or not the address exists', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    renderWithProviders(<ForgotPasswordPage />);

    await user.type(screen.getByPlaceholderText('Email address'), 'who@example.com');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // The server answers 204 for every case by design; the client must not
    // invent a distinction it was careful not to make.
    expect(await screen.findByText(/if that address has an account/i)).toBeInTheDocument();
  });

  it('surfaces the rate limit distinctly from a failure', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '42' }),
      })
    );
    renderWithProviders(<ForgotPasswordPage />);
    await user.type(screen.getByPlaceholderText('Email address'), 'a@b.co');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByText(/42 seconds/)).toBeInTheDocument();
  });

  it('shows a mail-not-configured message on 404, and does not claim a code is on its way', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    renderWithProviders(<ForgotPasswordPage />);
    await user.type(screen.getByPlaceholderText('Email address'), 'a@b.co');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/not configured on this server/i)).toBeInTheDocument();
    // Pins the defect: a 404 used to fall through to the generic success
    // branch, telling the user a code was coming when mail is not even set up.
    expect(screen.queryByText(/reset code is on its way/i)).not.toBeInTheDocument();
  });

  it('sends a user who already has a code onward to the code-entry screen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ForgotPasswordPage />);

    const button = screen.getByRole('button', { name: /have a code/i });
    // Lives in its own card, so it is never inside the address form.
    expect(button.closest('form')).toBeNull();
    await user.click(button);
    expect(routerMocks.navigate).toHaveBeenCalledWith('/reset-password');
  });

  it('offers a back-to-sign-in button below the cards', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ForgotPasswordPage />);

    const button = screen.getByRole('button', { name: /back to sign in/i });
    expect(button.closest('form')).toBeNull();
    await user.click(button);
    expect(routerMocks.navigate).toHaveBeenCalledWith('/login');
  });

  // The "Send reset code" button already says what the form does.
  it('does not explain the form in a lead paragraph', () => {
    renderWithProviders(<ForgotPasswordPage />);
    expect(screen.queryByText(/send you a reset code/i)).toBeNull();
  });

  // The card is sized by its fields, exactly as the login card is, so the two
  // screens do not visibly resize as the user moves between them.
  it('sizes the card to the same width as the login card', () => {
    const { container } = renderWithProviders(<ForgotPasswordPage />);
    // The width sits on the block wrapping the form, not the form itself, so
    // the card keeps it once the form is replaced by a confirmation.
    const content = (container.querySelector('form') as HTMLElement).parentElement as HTMLElement;
    expect(getComputedStyle(content).minWidth).toBe('400px');
  });
});

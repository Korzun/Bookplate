import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { ForgotPasswordPage } from './index';

describe('ForgotPasswordPage', () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it('links onward to the code-entry screen', () => {
    renderWithProviders(<ForgotPasswordPage />);
    expect(screen.getByRole('link', { name: /have a code/i })).toHaveAttribute(
      'href',
      '/reset-password'
    );
  });
});

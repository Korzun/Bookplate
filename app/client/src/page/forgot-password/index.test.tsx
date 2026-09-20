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

  it('links onward to the code-entry screen', () => {
    renderWithProviders(<ForgotPasswordPage />);
    expect(screen.getByRole('link', { name: /have a code/i })).toHaveAttribute(
      'href',
      '/reset-password'
    );
  });
});

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { WelcomePage } from './index';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setToken: vi.fn(),
  search: '',
}));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(mocks.search)],
}));
vi.mock('~/lib/token', async (orig) => ({
  ...(await orig<typeof import('~/lib/token')>()),
  setToken: mocks.setToken,
}));

const fill = async (user: ReturnType<typeof userEvent.setup>, password = 'chosen-password') => {
  await user.type(screen.getByPlaceholderText('New password'), password);
  await user.type(screen.getByPlaceholderText('Confirm new password'), password);
};

describe('WelcomePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.navigate.mockReset();
    mocks.setToken.mockReset();
    mocks.search = '';
  });

  it('prefills the address and code from the link and fires no request on mount', () => {
    mocks.search = 'code=K7M2QX4P&email=new%40example.com';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<WelcomePage />);

    expect(screen.getByPlaceholderText('Email address')).toHaveValue('new@example.com');
    expect(screen.getByPlaceholderText('Welcome code')).toHaveValue('K7M2QX4P');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits to /api/onboard and stores the returned token', async () => {
    mocks.search = 'code=K7M2QX4P&email=new%40example.com';
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accessToken: 'a.b.c' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<WelcomePage />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/onboard',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'new@example.com',
          code: 'K7M2QX4P',
          newPassword: 'chosen-password',
        }),
      })
    );
    expect(mocks.setToken).toHaveBeenCalledWith('a.b.c');
  });

  it('refuses mismatched passwords without a request', async () => {
    mocks.search = 'code=K7M2QX4P&email=new%40example.com';
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<WelcomePage />);

    await user.type(screen.getByPlaceholderText('New password'), 'chosen-password');
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'different-password');
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText('Those passwords do not match')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server message on 400 and points to the admin, not forgot-password', async () => {
    mocks.search = 'code=K7M2QX4P&email=new%40example.com';
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'That link is not valid or has expired.' }),
      })
    );
    renderWithProviders(<WelcomePage />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(
      await screen.findByText(/That link is not valid or has expired\. Ask your library admin/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /forgot/i })).toBeNull();
    expect(mocks.setToken).not.toHaveBeenCalled();
  });

  it('reports a rate limit with the retry delay', async () => {
    mocks.search = 'code=K7M2QX4P&email=new%40example.com';
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '30' }),
      })
    );
    renderWithProviders(<WelcomePage />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(
      await screen.findByText('Too many attempts — try again in 30 seconds')
    ).toBeInTheDocument();
  });

  it('offers a back-to-sign-in button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WelcomePage />);
    await user.click(screen.getByRole('button', { name: /back to sign in/i }));
    expect(mocks.navigate).toHaveBeenCalledWith('/login');
  });
});

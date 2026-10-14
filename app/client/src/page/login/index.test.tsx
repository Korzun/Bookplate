import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigContext } from '~/provider/config';
import { renderWithProviders } from '~/test-utils';

import { LoginPage } from './index';

const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => routerMocks.navigate,
}));

// `renderWithConfig` is not a shared test-utils helper (only this suite needs
// email-config variance), so it is a thin local wrapper around
// `renderWithProviders` rather than a new export from `~/test-utils`.
function renderWithConfig(
  ui: ReactElement,
  {
    emailEnabled,
    onboardingEnabled = emailEnabled,
  }: { emailEnabled: boolean; onboardingEnabled?: boolean }
) {
  return renderWithProviders(
    <ConfigContext.Provider value={{ libraryName: 'Bookplate', emailEnabled, onboardingEnabled }}>
      {ui}
    </ConfigContext.Provider>
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    routerMocks.navigate.mockReset();
  });

  it('submits credentials when the form is submitted', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(screen.getByPlaceholderText('Username'), 'alice');
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/login', expect.anything()));
  });

  it('submits on Enter inside a field without a manual handler', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);
    await user.type(screen.getByPlaceholderText('Username'), 'alice');
    await user.type(screen.getByPlaceholderText('Password'), 'secret{Enter}');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/login', expect.anything()));
  });

  // The Sign In button is a native <button> in submit mode, which shrink-wraps
  // its label instead of filling the card the way a div does. The form's flex
  // column is what stretches it back across the card, level with the fields.
  it('lays the form out as a column so Sign In spans the card', () => {
    const { container } = renderWithProviders(<LoginPage />);
    const style = getComputedStyle(container.querySelector('form') as HTMLElement);
    expect(style.display).toBe('flex');
    expect(style.flexDirection).toBe('column');
  });

  it('shows a retry-after message on 429 rather than "Invalid credentials"', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '42' } }))
    );

    renderWithProviders(<LoginPage />);
    await user.type(screen.getByPlaceholderText('Username'), 'alice');
    await user.type(screen.getByPlaceholderText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
    expect(screen.getByText(/42 second/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid credentials/i)).not.toBeInTheDocument();
  });

  it('explains a not-yet-onboarded account on 403 when onboarding is enabled', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 }))
    );

    renderWithConfig(<LoginPage />, { emailEnabled: true });
    await user.type(screen.getByPlaceholderText('Username or email'), 'newbie1');
    await user.type(screen.getByPlaceholderText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      await screen.findByText(
        "This account hasn't been set up yet — use the link in your welcome email."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/invalid credentials/i)).not.toBeInTheDocument();
  });

  it('keeps "Invalid credentials" on 403 when email is not enabled', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 }))
    );

    renderWithConfig(<LoginPage />, { emailEnabled: false });
    await user.type(screen.getByPlaceholderText('Username'), 'alice');
    await user.type(screen.getByPlaceholderText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });

  // Mail without `public_url`: no account is ever registered password-less, so
  // a 403 has nothing to do with a welcome email.
  it('keeps "Invalid credentials" on 403 when email is on but onboarding is not', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 }))
    );

    renderWithConfig(<LoginPage />, { emailEnabled: true, onboardingEnabled: false });
    await user.type(screen.getByPlaceholderText('Username or email'), 'alice');
    await user.type(screen.getByPlaceholderText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });

  it('still shows "Invalid credentials" on 401', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 }))
    );

    renderWithProviders(<LoginPage />);
    await user.type(screen.getByPlaceholderText('Username'), 'alice');
    await user.type(screen.getByPlaceholderText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });

  it('falls back to a generic wait message when Retry-After is absent', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429 }))
    );

    renderWithProviders(<LoginPage />);
    await user.type(screen.getByPlaceholderText('Username'), 'alice');
    await user.type(screen.getByPlaceholderText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });

  // A default Button below the card, not a link inside the form: `Button` has
  // no anchor mode, so it navigates through `useNavigate` the way every other
  // button in the app does.
  it('offers a forgot-password button that sends the user onward when email is enabled', async () => {
    const user = userEvent.setup();
    renderWithConfig(<LoginPage />, { emailEnabled: true });

    const button = screen.getByRole('button', { name: /forgot/i });
    // Outside the form, so it cannot be mistaken for a second submit control.
    expect(button.closest('form')).toBeNull();
    await user.click(button);
    expect(routerMocks.navigate).toHaveBeenCalledWith('/forgot-password');
  });

  it('offers no forgot-password button when email is disabled', () => {
    renderWithConfig(<LoginPage />, { emailEnabled: false });
    expect(screen.queryByRole('button', { name: /forgot/i })).toBeNull();
  });

  // A new user's only way in is the link in their welcome email, so the
  // sign-in page offers no route to the welcome page of its own.
  it('offers no set-up-account button, even when email is enabled', () => {
    renderWithConfig(<LoginPage />, { emailEnabled: true });
    expect(screen.queryByRole('button', { name: /set up/i })).toBeNull();
  });

  it('labels the identifier field for email when email is enabled', () => {
    renderWithConfig(<LoginPage />, { emailEnabled: true });
    expect(screen.getByPlaceholderText('Username or email')).toBeInTheDocument();
  });

  it('labels it Username when email is disabled', () => {
    renderWithConfig(<LoginPage />, { emailEnabled: false });
    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
  });
});

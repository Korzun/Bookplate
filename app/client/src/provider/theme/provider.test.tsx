import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeJwt } from '~/lib/test-jwt';
import { clearToken, setToken } from '~/lib/token';

import { Context } from './context';
import { ThemeProvider } from './provider';

// A signed-in access token for the given user, wrapped in act because
// setToken/clearToken dispatch the token-changed event the provider listens to.
const tokenFor = (sub: string) =>
  makeJwt({ sub, username: sub, isAdmin: false, mustChangePassword: false, exp: 9999999999 });
const login = (sub: string) => act(() => setToken(tokenFor(sub)));
const logout = () => act(() => clearToken());

// Controllable matchMedia: tests set `current.matches` and fire change listeners.
const current = { matches: false, listeners: new Set<(e: { matches: boolean }) => void>() };
function installMatchMedia() {
  current.matches = false;
  current.listeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return current.matches;
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) =>
      current.listeners.add(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) =>
      current.listeners.delete(cb),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
function setSystemDark(matches: boolean) {
  current.matches = matches;
  act(() => current.listeners.forEach((cb) => cb({ matches })));
}

// Probe renders the resolved mode from context so assertions are simple.
const Probe = () => {
  return (
    <Context.Consumer>
      {({ resolvedMode, setting, setSetting }) => (
        <div>
          <span data-testid="mode">{resolvedMode}</span>
          <span data-testid="setting">{setting}</span>
          <button onClick={() => setSetting('dark')}>go dark</button>
        </div>
      )}
    </Context.Consumer>
  );
};

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    installMatchMedia();
  });
  afterEach(() => localStorage.clear());

  it('defaults to auto and follows the OS (light)', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByTestId('setting')).toHaveTextContent('auto');
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
  });

  it('auto resolves to dark when the OS is dark', () => {
    current.matches = true;
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('auto updates live when the OS theme changes', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
    setSystemDark(true);
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('persists a signed-in user’s explicit choice under a per-user key', async () => {
    const user = userEvent.setup();
    login('alice');
    const { unmount } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    await user.click(screen.getByText('go dark'));
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(localStorage.getItem('theme-setting:alice')).toBe('dark');
    // No stray global key that could leak across users / survive logout.
    expect(localStorage.getItem('theme-setting')).toBeNull();

    unmount();
    installMatchMedia(); // OS = light
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    expect(screen.getByTestId('setting')).toHaveTextContent('dark');
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('returns to auto when the user logs out', async () => {
    const user = userEvent.setup();
    login('alice');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    await user.click(screen.getByText('go dark'));
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');

    logout();
    expect(screen.getByTestId('setting')).toHaveTextContent('auto');
    expect(screen.getByTestId('mode')).toHaveTextContent('light'); // follows OS again
  });

  it('restores the user’s saved choice when they log back in', async () => {
    const user = userEvent.setup();
    login('alice');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    await user.click(screen.getByText('go dark'));
    logout();
    expect(screen.getByTestId('setting')).toHaveTextContent('auto');

    login('alice');
    expect(screen.getByTestId('setting')).toHaveTextContent('dark');
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('does not leak one user’s choice to another', async () => {
    const user = userEvent.setup();
    login('alice');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    await user.click(screen.getByText('go dark'));
    logout();

    login('bob');
    expect(screen.getByTestId('setting')).toHaveTextContent('auto');
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
  });
});

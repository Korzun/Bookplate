import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { describe, expect, it } from 'vitest';

import {
  Context as AuthContext,
  type AuthContext as AuthContextType,
} from '../provider/auth/context';
import { ThemeProvider } from '../provider/theme/provider';
import { ProtectedRoute } from './protected-route';

const baseState = {
  userId: undefined,
  mustSetEmail: false,
};

function renderWithAuth(authState: AuthContextType, initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider>
        <AuthContext.Provider value={authState}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<div>home page</div>} />
              <Route path="/user" element={<div>user page</div>} />
              <Route path="/library" element={<div>library page</div>} />
              <Route path="/password-reset" element={<div>password reset page</div>} />
              <Route path="/set-email" element={<div>set email page</div>} />
            </Route>
            <Route path="/login" element={<div>login page</div>} />
          </Routes>
        </AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  it('redirects to /login when not authenticated', () => {
    renderWithAuth(
      {
        ...baseState,
        username: undefined,
        isAdmin: false,
        mustChangePassword: false,
        loading: false,
      },
      ['/library']
    );
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('shows loading when not authenticated and loading', () => {
    renderWithAuth(
      {
        ...baseState,
        username: undefined,
        isAdmin: false,
        mustChangePassword: false,
        loading: true,
      },
      ['/library']
    );
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('renders the route when authenticated and loading', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'alice',
        isAdmin: false,
        mustChangePassword: false,
        loading: true,
      },
      ['/library']
    );
    expect(screen.getByText('library page')).toBeInTheDocument();
  });

  it('renders the route when authenticated and mustChangePassword is false', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'alice',
        isAdmin: false,
        mustChangePassword: false,
        loading: false,
      },
      ['/library']
    );
    expect(screen.getByText('library page')).toBeInTheDocument();
  });

  it('redirects to /password-reset when mustChangePassword is true and not already on /password-reset', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'alice',
        isAdmin: false,
        mustChangePassword: true,
        loading: false,
      },
      ['/library']
    );
    expect(screen.getByText('password reset page')).toBeInTheDocument();
  });

  it('renders /password-reset when mustChangePassword is true', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'alice',
        isAdmin: false,
        mustChangePassword: true,
        loading: false,
      },
      ['/password-reset']
    );
    expect(screen.getByText('password reset page')).toBeInTheDocument();
  });

  it('redirects to home when mustChangePassword is false and at /password-reset', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'alice',
        isAdmin: false,
        mustChangePassword: false,
        loading: false,
      },
      ['/password-reset']
    );
    expect(screen.getByText('home page')).toBeInTheDocument();
  });

  it('sends a viewer who owes an address to the set-email page', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'ann',
        isAdmin: false,
        mustChangePassword: false,
        mustSetEmail: true,
        loading: false,
      },
      ['/library']
    );
    expect(screen.getByText('set email page')).toBeInTheDocument();
  });

  // Ordering matters: a new account owes both, and choosing a password is the
  // step that must come first. Mirrors the server, where passwordChangeGate is
  // mounted ahead of emailSetupGate.
  it('sends a viewer who owes a password change to the password page FIRST', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'ann',
        isAdmin: false,
        mustChangePassword: true,
        mustSetEmail: true,
        loading: false,
      },
      ['/library']
    );
    expect(screen.getByText('password reset page')).toBeInTheDocument();
  });

  // Regression test for the infinite-redirect loop this component's own
  // history includes: without the `mustSetEmail` checks nested inside
  // `if (!mustChangePassword)`, a viewer owing both, starting directly at
  // /set-email, ping-pongs forever between /password-reset and /set-email
  // (mustChangePassword sends them to /password-reset; re-rendered there,
  // the un-nested mustSetEmail check fires because the pathname isn't
  // /set-email, sending them right back). This is the exact cell that hung
  // the test suite during development — do not "simplify" this test away as
  // redundant with the /library-starting ordering test above; it pins the
  // guard, not just the outcome.
  it('sends a viewer who owes both, starting AT /set-email, to /password-reset (not stuck in a loop)', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'ann',
        isAdmin: false,
        mustChangePassword: true,
        mustSetEmail: true,
        loading: false,
      },
      ['/set-email']
    );
    expect(screen.getByText('password reset page')).toBeInTheDocument();
  });

  it('bounces a viewer off the set-email page once they have an address', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'ann',
        isAdmin: false,
        mustChangePassword: false,
        mustSetEmail: false,
        loading: false,
      },
      ['/set-email']
    );
    expect(screen.getByText('home page')).toBeInTheDocument();
  });

  // I2 (important, whole-branch review): the verification email always links
  // to `/set-email?code=...` (`services/mail-template.ts`), but changing an
  // address from the settings card never sets `mustSetEmail` (only an
  // outstanding, unset address does) — so a viewer who isn't gated used to be
  // bounced home before ever seeing the code field, and the emailed link
  // never worked for them. Falsifiable: dropping the `!hasEmailCode` /
  // `?code=` check from `ProtectedRoute` makes this test see "home page"
  // again instead of "set email page".
  it('renders /set-email for a non-gated viewer whose URL carries a verification code', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'ann',
        isAdmin: false,
        mustChangePassword: false,
        mustSetEmail: false,
        loading: false,
      },
      ['/set-email?code=ABC12345']
    );
    expect(screen.getByText('set email page')).toBeInTheDocument();
  });

  // The password redirect still wins over a `?code=`, even for a non-gated
  // set-email link — that ordering is load-bearing on three surfaces (this
  // route, the server's gate mount order, and `emailSetupAllowed`).
  it('still sends a viewer who owes a password change to /password-reset, code or not', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'ann',
        isAdmin: false,
        mustChangePassword: true,
        mustSetEmail: false,
        loading: false,
      },
      ['/set-email?code=ABC12345']
    );
    expect(screen.getByText('password reset page')).toBeInTheDocument();
  });

  it('leaves an ordinary viewer alone', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'ann',
        isAdmin: false,
        mustChangePassword: false,
        mustSetEmail: false,
        loading: false,
      },
      ['/library']
    );
    expect(screen.getByText('library page')).toBeInTheDocument();
  });
});

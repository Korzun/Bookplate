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

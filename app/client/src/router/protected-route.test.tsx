import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import {
  Context as AuthContext,
  type AuthContext as AuthContextType,
} from '../provider/auth/context';
import { ThemeProvider } from '../provider/theme/provider';

import { ProtectedRoute } from './protected-route';

const baseState = {
  userId: undefined,
};

function renderWithAuth(authState: AuthContextType, initialEntries: string[]) {
  return render(
    <MemoryRouter
      initialEntries={initialEntries}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ThemeProvider>
        <AuthContext.Provider value={authState}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<div>home page</div>} />
              <Route path="/user" element={<div>user page</div>} />
              <Route path="/library" element={<div>library page</div>} />
              <Route path="/password-reset" element={<div>password reset page</div>} />
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
});

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
  setUsername: () => {},
  setIsAdmin: () => {},
  setMustChangePassword: () => {},
  refetch: () => Promise.resolve(),
};

function renderWithAuth(authState: AuthContextType, initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider>
        <AuthContext.Provider value={authState}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/user" element={<div>user page</div>} />
              <Route path="/library" element={<div>library page</div>} />
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
        error: true,
        errorMessage: undefined,
      },
      ['/library']
    );
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('renders the route when authenticated and mustChangePassword is false', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'alice',
        isAdmin: false,
        mustChangePassword: false,
        loading: false,
        error: false,
        errorMessage: undefined,
      },
      ['/library']
    );
    expect(screen.getByText('library page')).toBeInTheDocument();
  });

  it('redirects to /user when mustChangePassword is true and not already on /user', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'alice',
        isAdmin: false,
        mustChangePassword: true,
        loading: false,
        error: false,
        errorMessage: undefined,
      },
      ['/library']
    );
    expect(screen.getByText('user page')).toBeInTheDocument();
  });

  it('renders /user when mustChangePassword is true', () => {
    renderWithAuth(
      {
        ...baseState,
        username: 'alice',
        isAdmin: false,
        mustChangePassword: true,
        loading: false,
        error: false,
        errorMessage: undefined,
      },
      ['/user']
    );
    expect(screen.getByText('user page')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';

import {
  Context as AuthContext,
  type AuthContext as AuthContextType,
} from '../provider/auth/context';
import { UnprotectedRoute } from './unprotected-route';

const SetEmailProbe = () => {
  const location = useLocation();
  return <div>set email page {location.search}</div>;
};

const baseState: AuthContextType = {
  username: undefined,
  userId: undefined,
  isAdmin: false,
  mustChangePassword: false,
  mustSetEmail: false,
  loading: false,
};

function renderWithAuth(
  authState: AuthContextType,
  initialEntries: (string | { pathname: string; state?: unknown })[]
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthContext.Provider value={authState}>
        <Routes>
          <Route element={<UnprotectedRoute />}>
            <Route path="/login" element={<div>login page</div>} />
          </Route>
          <Route path="/" element={<div>home page</div>} />
          <Route path="/set-email" element={<SetEmailProbe />} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

describe('UnprotectedRoute', () => {
  it('renders the route when not authenticated', () => {
    renderWithAuth({ ...baseState, username: undefined }, ['/login']);
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('redirects home when authenticated with no prior destination', () => {
    renderWithAuth({ ...baseState, username: 'ann' }, ['/login']);
    expect(screen.getByText('home page')).toBeInTheDocument();
  });

  it('redirects to the prior destination when authenticated', () => {
    renderWithAuth({ ...baseState, username: 'ann' }, [
      { pathname: '/login', state: { from: { pathname: '/set-email', search: '' } } },
    ]);
    expect(screen.getByText(/set email page/)).toBeInTheDocument();
  });

  // I2 (important, whole-branch review): an emailed verification link points
  // at `/set-email?code=...`. A viewer who follows it while signed OUT gets
  // bounced through `/login` by `ProtectedRoute` with `state.from` carrying
  // the FULL location (pathname AND search) — but this route used to rebuild
  // the post-login destination from `state.from.pathname` alone, silently
  // dropping the `?code=` a second time. Falsifiable: reading only
  // `from.pathname` here makes this test see an empty search string instead
  // of `?code=ABC123`.
  it('preserves the query string of the prior destination, not only its pathname', () => {
    renderWithAuth({ ...baseState, username: 'ann' }, [
      {
        pathname: '/login',
        state: { from: { pathname: '/set-email', search: '?code=ABC123' } },
      },
    ]);
    expect(screen.getByText('set email page ?code=ABC123')).toBeInTheDocument();
  });
});

import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import {
  Context as AuthContext,
  type AuthContext as AuthContextType,
} from './provider/auth/context';
import { ThemeProvider } from './provider/theme/provider';
import { ToastProvider } from './provider/toast';

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  user?: { username: string; isAdmin: boolean; mustChangePassword?: boolean };
  initialEntries?: string[];
}

export function renderWithProviders(
  ui: ReactElement,
  {
    user = { username: '', isAdmin: false },
    initialEntries,
    ...options
  }: RenderWithProvidersOptions = {}
) {
  const authState: AuthContextType = {
    username: user.username || undefined,
    userId: user.username ? 'test-user-id' : undefined,
    isAdmin: user.isAdmin,
    mustChangePassword: user.mustChangePassword ?? false,
    loading: false,
  };

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <ThemeProvider>
          <ToastProvider>
            <AuthContext.Provider value={authState}>{children}</AuthContext.Provider>
          </ToastProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}

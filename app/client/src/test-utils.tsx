import { ApolloClient, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { MockLink, type MockedResponse } from '@apollo/client/testing';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

import { cacheConfig } from './provider/apollo';
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

interface RenderWithApolloOptions extends RenderWithProvidersOptions {
  mocks?: MockedResponse[];
}

/**
 * Renders with a REAL InMemoryCache built from the app's own `cacheConfig` over
 * Apollo's MockLink. The point is that cache-update functions are exercised
 * against the actual typePolicies — that is where the bugs are.
 *
 * The transport links (auth/refresh, SSE) are deliberately NOT in this chain;
 * they have dedicated tests rather than riding along in every screen test.
 *
 * Type your mocks as `MockedResponse<YourQueryType>` — `tsc --noEmit` (already
 * part of `npm run lint`) then rejects a mock whose shape the server could
 * never return, which is MockLink's one real weakness.
 */
export function renderWithApollo(
  ui: ReactElement,
  { mocks = [], ...options }: RenderWithApolloOptions = {}
) {
  const client = new ApolloClient({
    link: new MockLink(mocks),
    cache: new InMemoryCache(cacheConfig),
  });
  return renderWithProviders(<ApolloProvider client={client}>{ui}</ApolloProvider>, options);
}

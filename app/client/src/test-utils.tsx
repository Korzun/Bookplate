import { ApolloClient, InMemoryCache, type OperationVariables } from '@apollo/client';
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
 * Type your mocks as `MockedResponse<YourQueryType>` — an EXPLICIT annotation
 * on the mock itself (or its factory's return type), not just passing a bare
 * object literal into `mocks` below. `MockedResponse<TData>` only constrains
 * `result.data`; `request.query` stays a plain, untyped `DocumentNode`
 * regardless — MockLink never checks a mock's `result` against the document
 * it is keyed to, no matter how it's typed. With no explicit annotation,
 * `TData` is inferred permissively from whatever literal you wrote, so `tsc
 * --noEmit` (already part of `npm run lint`) silently accepts a `result.data`
 * shape the server could never return. As of this writing every mock in this
 * codebase is an unannotated bare literal, so none of them get this check.
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

type RenderHookWithApolloOptions = Omit<RenderWithApolloOptions, 'mocks'>;

/**
 * Renders a hook inside `renderWithApollo`'s provider stack via a throwaway
 * probe component, and hands back a `result.current` ref holding the hook's
 * latest return value — the shape hand-rolled at the top of roughly a dozen
 * `provider/*\/hook/*.test.tsx` files (each with its own local `Probe` and
 * `result` ref). This is that harness, extracted once.
 *
 * `TData`/`TVariables` flow into `mocks`' `MockedResponse<TData, TVariables>`
 * type, matching `renderWithApollo`'s own `mocks` shape — but the generic
 * position here does NOT by itself force adoption: passing an unannotated
 * bare object literal still type-checks with zero errors, because `TData`
 * then infers permissively from that literal instead of from a real query
 * type. The check only fires when a mock (or its factory's return type) is
 * EXPLICITLY annotated `MockedResponse<YourQuery>` — see `renderWithApollo`'s
 * comment above.
 */
export function renderHookWithApollo<
  T,
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
>(
  useHook: () => T,
  mocks: MockedResponse<TData, TVariables>[] = [],
  options: RenderHookWithApolloOptions = {}
) {
  const result: { current: T | undefined } = { current: undefined };

  function Probe() {
    result.current = useHook();
    return null;
  }

  const rendered = renderWithApollo(<Probe />, { ...options, mocks: mocks as MockedResponse[] });
  return { result, ...rendered };
}

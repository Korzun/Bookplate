import { ApolloClient, InMemoryCache, type OperationVariables } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { MockLink, type MockedResponse } from '@apollo/client/testing';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';

import { cacheConfig } from './provider/apollo';
import {
  Context as AuthContext,
  type AuthContext as AuthContextType,
} from './provider/auth/context';
import { ThemeProvider } from './provider/theme/provider';
import { ToastProvider } from './provider/toast';

/**
 * STANDING NOTE — the circular-import landmine (Ruling M).
 *
 * This codebase's import graph has roughly 70 circular-import cycles, many
 * pre-existing, centred on `control/upload-replace-modal →
 * component/fix-review → router → page/book-edit → component/index.ts`.
 * Two migration tasks in a row lost time to the SAME failure before this
 * note existed, so it lives here — the file every test author already
 * reads — instead of being rediscovered per task.
 *
 * **The landmine:** a `vi.mock('~/control', async (importOriginal) => ...)`
 * (or any `importOriginal()` call against a BARREL that sits inside that
 * cycle, e.g. `~/component`) poisons the module and breaks tests in a way
 * that looks completely unrelated to whatever change actually triggered it.
 *
 * **The symptom:** a component renders as `undefined` ("Element type is
 * invalid: expected a string ... but got: undefined"), or a mocked
 * module's real exports go missing, in a test that was previously green
 * and that you did not touch.
 *
 * **The fix:** do not call `importOriginal()` against a barrel that sits in
 * that cycle. Import the REAL components you need from their SUBPATHS
 * (e.g. `~/control/button`, `~/control/confirm-modal` — not `~/control`
 * itself) and stub only the component you are actually asserting on.
 *
 * **Diagnosing it:** plain `madge --circular` silently fails to resolve
 * this project's `~/` alias and reports a false single cycle. Run it with
 * `--ts-config tsconfig.json` to see the real ~70.
 */

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
 *
 * Returns the `client` it built, spread alongside `renderWithProviders`'s own
 * return value — `client.cache` is the only way a test can assert on cache
 * state (seeded via `client.cache.writeQuery`, inspected via
 * `client.cache.extract()`) rather than just on the hook/component's return
 * value. `test-utils.test.tsx` asserts this IS the cache instance the
 * rendered tree actually reads/writes, not a second, disconnected one.
 */
export function renderWithApollo(
  ui: ReactElement,
  { mocks = [], ...options }: RenderWithApolloOptions = {}
) {
  const client = new ApolloClient({
    link: new MockLink(mocks),
    cache: new InMemoryCache(cacheConfig),
  });
  return {
    client,
    ...renderWithProviders(<ApolloProvider client={client}>{ui}</ApolloProvider>, options),
  };
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

/**
 * A real `ApolloProvider`, backed by a `MockLink` (empty by default), for
 * hook/component tests that don't use `renderWithApollo`'s own provider
 * stack (they compose their own `wrapper` around
 * `AuthProvider`/etc.) but still transitively reach
 * `useWithTargetUser` — an unconditional `useQuery` since task 4's C-1/I-1
 * fix (no more provider-less fallback client; see that hook's own doc
 * comment for why a loud failure here is the point, not a bug to route
 * around). Most call sites default to a non-admin viewer, so that query is
 * always `skip`ped and the default empty `MockLink` never needs a matching
 * mock — drop `<ApolloTestProvider>` in anywhere above the hook under test.
 * Pass `mocks` when the test DOES need the query to resolve (e.g. an admin
 * scenario exercising `useWithTargetUser`/`useDownloadBook` together).
 */
export function ApolloTestProvider({
  children,
  mocks = [],
}: {
  children: ReactNode;
  mocks?: MockedResponse[];
}) {
  const [client] = useState(
    () => new ApolloClient({ link: new MockLink(mocks), cache: new InMemoryCache(cacheConfig) })
  );
  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}

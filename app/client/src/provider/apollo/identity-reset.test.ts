import { ApolloClient, InMemoryCache, type NormalizedCacheObject } from '@apollo/client';
import { MockLink } from '@apollo/client/testing';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { makeJwt } from '~/lib/test-jwt';
import { TOKEN_KEY, clearToken, setToken } from '~/lib/token';

import { cacheConfig } from './cache';
import { useResetApolloStoreOnIdentityChange } from './identity-reset';

const futureExp = () => Math.floor(Date.now() / 1000) + 900;

const tokenFor = (sub: string, exp = futureExp()) =>
  makeJwt({ sub, username: sub, isAdmin: false, mustChangePassword: false, exp });

const makeClient = () =>
  new ApolloClient({ cache: new InMemoryCache(cacheConfig), link: new MockLink([]) });

const writeViewer = (client: ApolloClient) => {
  client.cache.writeQuery({
    query: ViewerBootstrapDocument,
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        username: 'alice',
        isAdmin: false,
        mustChangePassword: false,
        user: { __typename: 'User', id: 'USER-1' },
        library: { __typename: 'Library', id: 'LIB-1' },
      },
    },
  });
};

const hasViewer = (client: ApolloClient) =>
  Boolean((client.cache.extract() as NormalizedCacheObject)['Viewer:{}']);

const dispatchStorage = (key: string | null, newValue: string | null) =>
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));

afterEach(() => {
  localStorage.clear();
});

describe('useResetApolloStoreOnIdentityChange', () => {
  it('clears the store when the identity changes (A -> B)', async () => {
    setToken(tokenFor('user-a'));
    const client = makeClient();
    renderHook(() => useResetApolloStoreOnIdentityChange(client));
    writeViewer(client);
    expect(hasViewer(client)).toBe(true);

    setToken(tokenFor('user-b'));

    await waitFor(() => expect(hasViewer(client)).toBe(false));
  });

  it('clears the store when identity appears (null -> B)', async () => {
    clearToken();
    const client = makeClient();
    renderHook(() => useResetApolloStoreOnIdentityChange(client));
    writeViewer(client);
    expect(hasViewer(client)).toBe(true);

    setToken(tokenFor('user-b'));

    await waitFor(() => expect(hasViewer(client)).toBe(false));
  });

  it('clears the store on a cross-tab identity change delivered via the storage event', async () => {
    setToken(tokenFor('user-a'));
    const client = makeClient();
    renderHook(() => useResetApolloStoreOnIdentityChange(client));
    writeViewer(client);
    expect(hasViewer(client)).toBe(true);

    // Simulate a sibling tab's write directly, the same way
    // provider/auth/provider.test.tsx's cross-tab suite does: mutate the
    // shared store and deliver the native `storage` event by hand, rather
    // than `setToken` (which would dispatch the in-tab event instead and
    // not exercise the storage listener).
    const sibling = tokenFor('user-b');
    localStorage.setItem(TOKEN_KEY, sibling);
    dispatchStorage(TOKEN_KEY, sibling);

    await waitFor(() => expect(hasViewer(client)).toBe(false));
  });

  // The test that stops an over-eager fix: a routine token refresh mints a
  // NEW token for the SAME identity (same `sub`) every few minutes. Clearing
  // on every token write — instead of only on an identity change — would
  // empty the cache constantly and cause refetch storms.
  it('does NOT clear the store when a token refresh keeps the same identity', async () => {
    setToken(tokenFor('user-a'));
    const client = makeClient();
    renderHook(() => useResetApolloStoreOnIdentityChange(client));
    writeViewer(client);
    expect(hasViewer(client)).toBe(true);

    // A different token value (different exp/signature), same `sub`.
    setToken(tokenFor('user-a', futureExp() + 1));

    // Give any (wrongly) scheduled clear a chance to run, then assert it
    // didn't: waiting on a negative needs a real settle window rather than a
    // `waitFor` on a condition that is already true.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hasViewer(client)).toBe(true);
  });
});

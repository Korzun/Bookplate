import type { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import { useApolloClient } from '@apollo/client/react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { makeJwt } from '~/lib/test-jwt';
import { setToken } from '~/lib/token';

import { ApolloRoot } from './provider';

const tokenFor = (sub: string) =>
  makeJwt({
    sub,
    username: sub,
    isAdmin: false,
    mustChangePassword: false,
    exp: Math.floor(Date.now() / 1000) + 900,
  });

const hasViewer = (client: ApolloClient) =>
  Boolean((client.cache.extract() as NormalizedCacheObject)['Viewer:{}']);

/** Grabs the client `ApolloRoot` provides, so the test can inspect its cache. */
const captureClient = () => {
  const captured: { current?: ApolloClient } = {};
  const Probe = () => {
    captured.current = useApolloClient();
    return null;
  };
  render(
    <ApolloRoot>
      <Probe />
    </ApolloRoot>
  );
  return captured;
};

afterEach(() => {
  localStorage.clear();
});

describe('ApolloRoot', () => {
  it('provides a client to its children', () => {
    const captured = captureClient();

    expect(captured.current).toBeDefined();
  });

  it('uses the app cache config, so Viewer normalizes as a singleton', () => {
    setToken(tokenFor('user-a'));
    const client = captureClient().current!;

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

    // `Viewer:{}` only exists if cacheConfig's `keyFields: []` policy is in
    // force; under Apollo's defaults Viewer would stay inline under ROOT_QUERY.
    expect(hasViewer(client)).toBe(true);
  });

  // The wiring test. `useResetApolloStoreOnIdentityChange` has thorough tests of
  // its own, but nothing pinned that ApolloRoot actually CALLS it — and an
  // unmounted identity reset is exactly the defect it exists to prevent: the
  // next user's cache-first queries silently serve the previous user's data.
  it('clears the store on an identity change, i.e. the reset hook is wired up', async () => {
    setToken(tokenFor('user-a'));
    const client = captureClient().current!;

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
    expect(hasViewer(client)).toBe(true);

    setToken(tokenFor('user-b'));

    await waitFor(() => expect(hasViewer(client)).toBe(false));
  });
});

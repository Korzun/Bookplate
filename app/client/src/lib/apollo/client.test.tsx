import type { NormalizedCacheObject } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { renderWithApollo } from '~/test-utils';

import { createApolloClient } from './client';

const Probe = () => {
  const { data } = useQuery(ViewerBootstrapDocument);
  return <div>{data?.viewer.username ?? 'loading'}</div>;
};

// Declared as a standalone value (not inlined into the `writeQuery` call) so
// TS excess-property checking, which only fires on object literals assigned
// directly into a typed position, does not fight the generated
// `ViewerBootstrapQuery` type: that type omits `__typename` at every level
// because the source document never selects it explicitly (Apollo injects it
// over the wire regardless), while `writeQuery` still needs real `__typename`
// values here to normalize `Viewer`/`User`/`Library` correctly.
const viewerData = {
  __typename: 'Viewer' as const,
  username: 'alice',
  isAdmin: false,
  mustChangePassword: false,
  user: { __typename: 'User' as const, id: 'USER-1' },
  library: { __typename: 'Library' as const, id: 'LIB-1' },
};

describe('createApolloClient', () => {
  it('builds a client whose cache uses the app cacheConfig', () => {
    const client = createApolloClient();
    client.cache.writeQuery({
      query: ViewerBootstrapDocument,
      data: { viewer: viewerData },
    });

    // Proves the Viewer singleton policy is in force, not Apollo's defaults.
    // `client.cache` is statically typed as the base `ApolloCache`, whose
    // `extract()` returns `unknown`; narrow to the shape `InMemoryCache`
    // actually produces rather than reaching for `any`.
    const store = client.cache.extract() as NormalizedCacheObject;
    expect(store['Viewer:{}']).toBeDefined();
  });
});

describe('renderWithApollo', () => {
  it('serves a mocked document through a real normalized cache', async () => {
    renderWithApollo(<Probe />, {
      mocks: [
        {
          request: { query: ViewerBootstrapDocument },
          result: { data: { viewer: viewerData } },
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
  });
});

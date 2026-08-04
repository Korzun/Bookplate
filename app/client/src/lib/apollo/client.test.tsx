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

describe('createApolloClient', () => {
  it('builds a client whose cache uses the app cacheConfig', () => {
    const client = createApolloClient();
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

    // Proves the Viewer singleton policy is in force, not Apollo's defaults.
    // `client.cache` is statically typed as the base `ApolloCache`, whose
    // `extract()` returns `unknown`, independent of the typename issue above;
    // narrow to the shape `InMemoryCache` actually produces instead of `any`.
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
          result: {
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
          },
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
  });
});

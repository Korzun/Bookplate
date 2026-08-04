import { InMemoryCache } from '@apollo/client';
import { gql } from '@apollo/client';
import { describe, expect, it } from 'vitest';

import { cacheConfig } from './cache';

const VIEWER_QUERY = gql`
  query V {
    viewer {
      username
    }
  }
`;

const PROGRESS_QUERY = gql`
  query P($id: ID!) {
    node(id: $id) {
      ... on Library {
        id
        progress(first: 1) {
          edges {
            node {
              userId
              document
              percentage
            }
          }
        }
      }
    }
  }
`;

const writeProgress = (cache: InMemoryCache, libraryId: string, userId: string, pct: number) =>
  cache.writeQuery({
    query: PROGRESS_QUERY,
    variables: { id: libraryId },
    data: {
      node: {
        __typename: 'Library',
        id: libraryId,
        progress: {
          __typename: 'LibraryProgressConnection',
          edges: [
            {
              __typename: 'LibraryProgressConnectionEdge',
              node: {
                __typename: 'Progress',
                userId,
                document: 'shared-doc-hash',
                percentage: pct,
              },
            },
          ],
        },
      },
    },
  });

describe('cacheConfig', () => {
  it('normalizes Viewer as a root singleton', () => {
    const cache = new InMemoryCache(cacheConfig);
    cache.writeQuery({
      query: VIEWER_QUERY,
      data: { viewer: { __typename: 'Viewer', username: 'alice' } },
    });

    // keyFields: [] gives the singleton entity `Viewer:{}`. Without it, Viewer
    // lives inline under ROOT_QUERY and is not addressable.
    expect(cache.extract()['Viewer:{}']).toMatchObject({ username: 'alice' });
  });

  // SEEN-TO-FAIL: this is the test that must fail if Progress reverts to
  // keyFields: ['document']. Two users owning the SAME book share a `document`
  // value (it is a KOReader content hash), so a single-user fixture passes
  // either way and proves nothing.
  it('keys Progress on (userId, document) so two users do not collapse', () => {
    const cache = new InMemoryCache(cacheConfig);
    writeProgress(cache, 'LIB-A', 'user-a', 10);
    writeProgress(cache, 'LIB-B', 'user-b', 90);

    const a = cache.readQuery<{
      node: { progress: { edges: { node: { percentage: number } }[] } };
    }>({ query: PROGRESS_QUERY, variables: { id: 'LIB-A' } });
    const b = cache.readQuery<{
      node: { progress: { edges: { node: { percentage: number } }[] } };
    }>({ query: PROGRESS_QUERY, variables: { id: 'LIB-B' } });

    expect(a?.node.progress.edges[0].node.percentage).toBe(10);
    expect(b?.node.progress.edges[0].node.percentage).toBe(90);
  });

  it('registers pagination policies on all four connection fields', () => {
    const policies = cacheConfig.typePolicies ?? {};
    expect(Object.keys(policies.Library?.fields ?? {}).sort()).toEqual([
      'book',
      'entries',
      'progress',
    ]);
    expect(Object.keys(policies.Series?.fields ?? {})).toEqual(['books']);
    expect(Object.keys(policies.Validation?.fields ?? {})).toEqual(['messages']);
  });

  it('carries possibleTypes for the result unions', () => {
    expect(cacheConfig.possibleTypes?.['LibraryEntry']).toEqual(
      expect.arrayContaining(['Book', 'Series'])
    );
  });
});

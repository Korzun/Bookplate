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
              id
              document
              percentage
            }
          }
        }
      }
    }
  }
`;

const writeProgress = (cache: InMemoryCache, libraryId: string, progressId: string, pct: number) =>
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
                id: progressId,
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
  // either way and proves nothing. `id` is Progress's global ID, computed
  // server-side from `[userId, document]` — two ids below stand in for two
  // different users sharing the same `document`.
  it('keys Progress on its global id so two users sharing a document do not collapse', () => {
    const cache = new InMemoryCache(cacheConfig);
    writeProgress(cache, 'LIB-A', 'progress-id-user-a', 10);
    writeProgress(cache, 'LIB-B', 'progress-id-user-b', 90);

    const a = cache.readQuery<{
      node: { progress: { edges: { node: { percentage: number } }[] } };
    }>({ query: PROGRESS_QUERY, variables: { id: 'LIB-A' } });
    const b = cache.readQuery<{
      node: { progress: { edges: { node: { percentage: number } }[] } };
    }>({ query: PROGRESS_QUERY, variables: { id: 'LIB-B' } });

    expect(a?.node.progress.edges[0].node.percentage).toBe(10);
    expect(b?.node.progress.edges[0].node.percentage).toBe(90);

    // M-2: the two assertions above pass even with `Progress: { keyFields:
    // false }` (no normalization at all) — both `Library` parents already
    // differ, which is enough on its own to keep the two reads apart. That
    // rules out `keyFields: ['document']` and nothing else; it does not
    // prove `Progress` is actually normalized under its id. Assert the
    // entity itself exists in the flat cache, mirroring the `Viewer` test
    // above.
    expect(cache.extract()['Progress:progress-id-user-a']).toMatchObject({ percentage: 10 });
    expect(cache.extract()['Progress:progress-id-user-b']).toMatchObject({ percentage: 90 });
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

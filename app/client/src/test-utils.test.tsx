import type { NormalizedCacheObject } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeviceListDocument } from '~/page/device-list';

import { renderHookWithApollo, renderWithApollo } from './test-utils';

const deviceListMock = {
  request: { query: DeviceListDocument },
  result: {
    data: {
      __typename: 'Query' as const,
      viewer: {
        __typename: 'Viewer' as const,
        devices: [
          {
            __typename: 'Device' as const,
            id: 'd1',
            name: 'Kindle',
            slug: 'kindle',
            coverWidth: null,
            coverHeight: null,
            coverFit: 'CONTAIN' as const,
            bwCover: false,
            simplify: true,
          },
        ],
      },
    },
  },
};

describe('renderHookWithApollo', () => {
  it('returns the hook value and re-renders on cache writes', async () => {
    const { result } = renderHookWithApollo(() => useQuery(DeviceListDocument), [deviceListMock]);

    expect(result.current?.loading).toBe(true);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.data?.viewer.devices).toEqual([
      {
        __typename: 'Device',
        id: 'd1',
        name: 'Kindle',
        slug: 'kindle',
        coverWidth: null,
        coverHeight: null,
        coverFit: 'CONTAIN',
        bwCover: false,
        simplify: true,
      },
    ]);
  });

  // Guards the seam every cache-assertion test in this codebase depends on:
  // `client` must be the SAME ApolloClient instance wired into the rendered
  // tree's `<ApolloProvider>`, not a second, disconnected one built
  // alongside it. If a future refactor broke that (e.g. constructing two
  // separate `ApolloClient`s instead of sharing one), every test that seeds
  // or inspects `client.cache` would silently observe an empty cache while
  // the rendered tree kept working off its own — a false pass, not a
  // failure. Proven here by letting the RENDERED TREE write into the cache
  // (a real query resolving over `MockLink`, exactly how a hook under test
  // normally populates it) and then reading that data back out through the
  // returned `client.cache.extract()`, not through `result.current`.
  it('returns the same client instance the rendered tree writes its cache through', async () => {
    const { result, client } = renderHookWithApollo(
      () => useQuery(DeviceListDocument),
      [deviceListMock]
    );

    await waitFor(() => expect(result.current?.loading).toBe(false));

    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(extracted['Device:d1']).toMatchObject({
      __typename: 'Device',
      id: 'd1',
      name: 'Kindle',
    });
  });
});

describe('renderWithApollo', () => {
  it('is what renderHookWithApollo forwards client from', () => {
    // renderHookWithApollo spreads renderWithApollo's return, so this is a
    // sanity check that renderWithApollo itself exposes `client` — not a
    // property `renderHookWithApollo` invents on its own.
    const { client, unmount } = renderWithApollo(<></>);
    expect(client.cache).toBeDefined();
    unmount();
  });
});

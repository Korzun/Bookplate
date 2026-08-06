import { useQuery } from '@apollo/client/react';
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeviceListDocument } from '~/graphql/device';

import { renderHookWithApollo } from './test-utils';

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
});

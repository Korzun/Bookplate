import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeviceListDocument } from '~/graphql/device';
import { renderWithApollo } from '~/test-utils';

import { useDeviceList, type UseDeviceList } from './use-device-list';

const device = (overrides: Record<string, unknown>) => ({
  __typename: 'Device' as const,
  id: 'd1',
  name: 'Kindle',
  slug: 'kindle',
  coverWidth: null,
  coverHeight: null,
  coverFit: 'CONTAIN' as const,
  bwCover: false,
  simplify: true,
  ...overrides,
});

const deviceListMock = (devices: ReturnType<typeof device>[]) => ({
  request: { query: DeviceListDocument },
  result: {
    data: {
      __typename: 'Query' as const,
      viewer: {
        __typename: 'Viewer' as const,
        devices,
      },
    },
  },
});

/** Renders the hook inside renderWithApollo's provider stack. */
const renderDeviceList = (mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']) => {
  const result: { current?: UseDeviceList } = {};
  const Probe = () => {
    result.current = useDeviceList();
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

describe('useDeviceList', () => {
  it('returns devices in name order with the tuple shape unchanged', async () => {
    const result = renderDeviceList([
      deviceListMock([
        device({ id: 'd2', name: 'Zebra reader', slug: 'zebra' }),
        device({ id: 'd1', name: 'Kindle', slug: 'kindle' }),
      ]),
    ]);

    await waitFor(() => expect(result.current?.[1]).toBe(false));
    expect(result.current?.[2]).toBe(false);
    expect(result.current?.[3]).toBeUndefined();
    expect(result.current?.[0].map((d) => d.name)).toEqual(['Kindle', 'Zebra reader']);
    expect(result.current?.[0][0]).toMatchObject({
      id: 'd1',
      name: 'Kindle',
      slug: 'kindle',
      coverFit: 'contain',
    });
  });

  it('reports loading before the query resolves', () => {
    const result = renderDeviceList([deviceListMock([device({})])]);

    expect(result.current?.[1]).toBe(true);
    expect(result.current?.[0]).toEqual([]);
  });

  it('maps every CoverFit enum member to its lowercase client value', async () => {
    const result = renderDeviceList([
      deviceListMock([
        device({ id: 'd1', name: 'A', coverFit: 'CONTAIN' }),
        device({ id: 'd2', name: 'B', coverFit: 'COVER' }),
        device({ id: 'd3', name: 'C', coverFit: 'FILL' }),
        device({ id: 'd4', name: 'D', coverFit: 'SMART' }),
      ]),
    ]);

    await waitFor(() => expect(result.current?.[1]).toBe(false));
    expect(result.current?.[0].map((d) => d.coverFit)).toEqual([
      'contain',
      'cover',
      'fill',
      'smart',
    ]);
  });

  it('surfaces a GraphQL error as hasError with a message, not an empty list', async () => {
    // No `result`, an `error` instead: MockLink resolves this as a network
    // error on DeviceListDocument. An empty array here would render
    // identically to "you have no devices", which an earlier fix round in
    // this migration ruled unacceptable.
    const result = renderDeviceList([
      {
        request: { query: DeviceListDocument },
        error: new Error('device list query failed'),
      },
    ]);

    await waitFor(() => expect(result.current?.[2]).toBe(true));
    expect(result.current?.[3]).toBe('device list query failed');
    expect(result.current?.[0]).toEqual([]);
    expect(result.current?.[1]).toBe(false);
  });
});

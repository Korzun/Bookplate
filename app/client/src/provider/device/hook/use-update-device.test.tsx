import { ApolloClient, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { MockLink } from '@apollo/client/testing';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeviceListDocument } from '~/graphql/device';
import { cacheConfig } from '~/provider/apollo';

import { useDeviceList, useUpdateDevice } from '.';
import { Context } from '../context';
import type { Device, DeviceInput, DeviceList } from '../type';

/**
 * `useDeviceList` reads the Apollo cache (task 2); `useUpdateDevice` still
 * writes through this Context/REST (task 3's job to rewire). A real
 * `ApolloClient` seeded via `writeQuery` is what lets a test render both
 * hooks side by side without an "no ApolloProvider" crash, on a cache-first
 * read that never touches `MockLink`'s empty mock list.
 */
function makeWrapper(initialDevices: Device[] = []) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [deviceList, setDeviceListRaw] = useState<DeviceList>(
      Object.fromEntries(initialDevices.map((d) => [d.id, d]))
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const setDeviceList = useCallback(
      (updater: (prev: DeviceList) => DeviceList) => setDeviceListRaw(updater),
      []
    );
    const [client] = useState(() => {
      const apolloClient = new ApolloClient({
        link: new MockLink([]),
        cache: new InMemoryCache(cacheConfig),
      });
      apolloClient.writeQuery({
        query: DeviceListDocument,
        data: {
          __typename: 'Query',
          viewer: {
            __typename: 'Viewer',
            devices: initialDevices.map((device) => ({
              __typename: 'Device' as const,
              ...device,
              coverFit: device.coverFit.toUpperCase() as 'CONTAIN' | 'COVER' | 'FILL' | 'SMART',
            })),
          },
        },
      });
      return apolloClient;
    });
    return (
      <ApolloProvider client={client}>
        <Context.Provider
          value={{ deviceList, loading, error, setDeviceList, setLoading, setError }}
        >
          {children}
        </Context.Provider>
      </ApolloProvider>
    );
  };
}

const kindle: Device = {
  id: 'd1',
  name: 'Kindle',
  slug: 'kindle',
  coverWidth: null,
  coverHeight: null,
  coverFit: 'contain',
  bwCover: false,
  simplify: true,
};

const editedInput: DeviceInput = {
  name: 'Kindle',
  coverWidth: 600,
  coverHeight: 800,
  coverFit: 'cover',
  bwCover: true,
  simplify: false,
};

const editedDevice: Device = { ...kindle, ...editedInput, slug: 'kindle' };

describe('useUpdateDevice', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns an updateDevice function and initial false/undefined state', () => {
    const { result } = renderHook(() => useUpdateDevice(), { wrapper: makeWrapper() });
    const [updateDevice, loading, error, errorMessage] = result.current;
    expect(typeof updateDevice).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('sends a PATCH request to /api/devices/:id with the device input', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve(editedDevice) })
    );
    const { result } = renderHook(() => useUpdateDevice(), { wrapper: makeWrapper([kindle]) });
    await act(() => result.current[0]('d1', editedInput));
    expect(fetch).toHaveBeenCalledWith('/api/devices/d1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editedInput),
    });
  });

  it('returns the updated device but leaves the GraphQL-backed list untouched — decoupled until task 3 rewires the mutation onto the cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve(editedDevice) })
    );
    const { result } = renderHook(() => ({ update: useUpdateDevice(), list: useDeviceList() }), {
      wrapper: makeWrapper([kindle]),
    });
    const returned = await act(() => result.current.update[0]('d1', editedInput));
    expect(returned).toEqual(editedDevice);
    // useUpdateDevice still only writes to Context (REST); useDeviceList (task 2)
    // reads the Apollo cache, which this mutation never touches. The seeded
    // pre-edit `kindle` is therefore still what useDeviceList reports.
    expect(result.current.list[0]).toEqual([kindle]);
  });

  it('sets error and message when the server responds with a non-200 status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 400,
        json: () => Promise.resolve({ error: 'coverWidth must be a positive integer' }),
      })
    );
    const { result } = renderHook(() => useUpdateDevice(), { wrapper: makeWrapper([kindle]) });
    await act(() => result.current[0]('d1', editedInput));
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('coverWidth must be a positive integer');
  });
});

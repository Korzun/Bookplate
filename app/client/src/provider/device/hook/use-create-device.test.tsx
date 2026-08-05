import { ApolloClient, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { MockLink } from '@apollo/client/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeviceListDocument } from '~/graphql/device';
import { cacheConfig } from '~/provider/apollo';

import { useCreateDevice, useDeviceList } from '.';
import { Context } from '../context';
import type { Device, DeviceInput, DeviceList } from '../type';

/**
 * `useDeviceList` reads the Apollo cache (task 2); `useCreateDevice` still
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

const kindleInput: DeviceInput = {
  name: 'Kindle',
  coverWidth: null,
  coverHeight: null,
  coverFit: 'contain',
  bwCover: false,
  simplify: true,
};

describe('useCreateDevice', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns createDevice function and initial false/undefined state', () => {
    const { result } = renderHook(() => useCreateDevice(), { wrapper: makeWrapper() });
    const [createDevice, loading, error, errorMessage] = result.current;
    expect(typeof createDevice).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('sends POST request to /api/devices with the device input', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 201, json: () => Promise.resolve(kindle) })
    );
    const { result } = renderHook(() => useCreateDevice(), { wrapper: makeWrapper() });
    await act(() => result.current[0](kindleInput));
    expect(fetch).toHaveBeenCalledWith('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kindleInput),
    });
  });

  it('returns the created device on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 201, json: () => Promise.resolve(kindle) })
    );
    const { result } = renderHook(() => useCreateDevice(), { wrapper: makeWrapper() });
    const device = await act(() => result.current[0](kindleInput));
    expect(device).toEqual(kindle);
  });

  it('does not add the created device to the GraphQL-backed list — decoupled until task 3 rewires the mutation onto the cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 201, json: () => Promise.resolve(kindle) })
    );
    const { result } = renderHook(() => ({ create: useCreateDevice(), list: useDeviceList() }), {
      wrapper: makeWrapper(),
    });
    await act(() => result.current.create[0](kindleInput));
    // useCreateDevice still only writes to Context (REST); useDeviceList (task 2)
    // reads the Apollo cache, which this mutation never touches. The seeded
    // empty list is therefore still what useDeviceList reports.
    expect(result.current.list[0]).toEqual([]);
  });

  it('sets error and message when POST fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Server error')));
    const { result } = renderHook(() => useCreateDevice(), { wrapper: makeWrapper() });
    await act(() => result.current[0](kindleInput));
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Server error');
  });

  it('sets error when the server responds with a non-201 status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 409,
        json: () => Promise.resolve({ error: 'A device with this name/slug already exists' }),
      })
    );
    const { result } = renderHook(() => useCreateDevice(), { wrapper: makeWrapper() });
    await act(() => result.current[0](kindleInput));
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('A device with this name/slug already exists');
  });

  it('sets loading to true while POST is pending', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );
    const { result } = renderHook(() => useCreateDevice(), { wrapper: makeWrapper() });
    act(() => {
      void result.current[0](kindleInput);
    });
    expect(result.current[1]).toBe(true);
    resolveFetch({ status: 201, json: () => Promise.resolve(kindle) });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });
});

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { Context } from '../context';
import type { Device, DeviceInput, DeviceList } from '../type';

import { useDeviceList, useUpdateDevice } from '.';

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
    return (
      <Context.Provider value={{ deviceList, loading, error, setDeviceList, setLoading, setError }}>
        {children}
      </Context.Provider>
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

  it('returns the updated device and replaces it in the list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve(editedDevice) })
    );
    const { result } = renderHook(() => ({ update: useUpdateDevice(), list: useDeviceList() }), {
      wrapper: makeWrapper([kindle]),
    });
    const returned = await act(() => result.current.update[0]('d1', editedInput));
    expect(returned).toEqual(editedDevice);
    expect(result.current.list[0]).toEqual([editedDevice]);
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

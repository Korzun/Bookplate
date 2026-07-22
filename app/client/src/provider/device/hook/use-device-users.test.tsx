import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDeviceUsers, useEnableDeviceUser, useDisableDeviceUser } from '.';

afterEach(() => vi.unstubAllGlobals());

describe('useDeviceUsers', () => {
  it('fetches the enabled usernames for the device on mount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(['alice', 'bob']) })
    );
    const { result } = renderHook(() => useDeviceUsers('d1'));
    await waitFor(() => expect(result.current[0]).toEqual(['alice', 'bob']));
    expect(fetch).toHaveBeenCalledWith('/api/devices/d1/users', {});
  });

  it('surfaces an error when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { result } = renderHook(() => useDeviceUsers('d1'));
    await waitFor(() => expect(result.current[2]).toBe(true));
  });

  it('performs no fetch and returns empty, non-loading state when no deviceId is given', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useDeviceUsers(undefined));
    expect(result.current).toEqual([[], false, false, undefined]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useEnableDeviceUser', () => {
  it('PUTs and returns true on 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const { result } = renderHook(() => useEnableDeviceUser());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current[0]('d1', 'alice');
    });
    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/devices/d1/users/alice', { method: 'PUT' });
  });

  it('returns false and sets error on non-204', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 404,
        json: () => Promise.resolve({ error: 'User not found' }),
      })
    );
    const { result } = renderHook(() => useEnableDeviceUser());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current[0]('d1', 'ghost');
    });
    expect(ok).toBe(false);
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('User not found');
  });
});

describe('useDisableDeviceUser', () => {
  it('DELETEs and returns true on 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const { result } = renderHook(() => useDisableDeviceUser());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current[0]('d1', 'alice');
    });
    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/devices/d1/users/alice', { method: 'DELETE' });
  });
});

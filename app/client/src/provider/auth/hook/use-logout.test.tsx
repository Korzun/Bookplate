import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLogout } from './use-logout';

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: { href: '' },
    writable: true,
    configurable: true,
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('useLogout', () => {
  it('returns initial state', () => {
    const { result } = renderHook(() => useLogout());
    const [logout, loading, error, errorMessage] = result.current;
    expect(typeof logout).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('calls POST /logout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
    const { result } = renderHook(() => useLogout());
    await act(() => result.current[0]());
    expect(fetch).toHaveBeenCalledWith('/logout', { method: 'POST' });
  });

  it('sets loading to true while fetch is in flight', async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((r) => {
          resolve = r;
        })
      )
    );
    const { result } = renderHook(() => useLogout());
    act(() => {
      void result.current[0]();
    });
    expect(result.current[1]).toBe(true);
    resolve({});
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  it('redirects to /login on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
    const { result } = renderHook(() => useLogout());
    await act(() => result.current[0]());
    expect(window.location.href).toBe('/login');
  });

  it('sets error state when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')));
    const { result } = renderHook(() => useLogout());
    await act(() => result.current[0]());
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Network down');
  });

  it('resets loading to false after an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')));
    const { result } = renderHook(() => useLogout());
    await act(() => result.current[0]());
    expect(result.current[1]).toBe(false);
  });
});

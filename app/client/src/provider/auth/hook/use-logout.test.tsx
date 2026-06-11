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

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('useLogout', () => {
  it('returns initial state', () => {
    const { result } = renderHook(() => useLogout());
    const [logout, loading, error, errorMessage] = result.current;
    expect(typeof logout).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('calls POST /api/auth/logout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { result } = renderHook(() => useLogout());
    await act(() => result.current[0]());
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
  });

  it('clears the stored access token on logout', async () => {
    localStorage.setItem('accessToken', 'some-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { result } = renderHook(() => useLogout());
    await act(() => result.current[0]());
    expect(localStorage.getItem('accessToken')).toBeNull();
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
    resolve({ ok: true });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  it('redirects to /login on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { result } = renderHook(() => useLogout());
    await act(() => result.current[0]());
    expect(window.location.href).toBe('/login');
  });

  it('does not clear the token or redirect when the server rejects logout', async () => {
    localStorage.setItem('accessToken', 'some-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderHook(() => useLogout());
    await act(() => result.current[0]());
    expect(result.current[2]).toBe(true);
    expect(localStorage.getItem('accessToken')).toBe('some-token');
    expect(window.location.href).toBe('');
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

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as logoutModule from '../../../lib/logout';
import { useLogout } from './use-logout';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useLogout', () => {
  it('returns initial state', () => {
    const { result } = renderHook(() => useLogout());
    const [logout, loading] = result.current;
    expect(typeof logout).toBe('function');
    expect(loading).toBe(false);
  });

  it('delegates to the shared logout helper', async () => {
    const spy = vi.spyOn(logoutModule, 'logout').mockResolvedValue();
    const { result } = renderHook(() => useLogout());

    await act(() => result.current[0]());

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reports loading across the call and clears it afterwards', async () => {
    let release!: () => void;
    vi.spyOn(logoutModule, 'logout').mockReturnValue(
      new Promise<void>((r) => {
        release = r;
      })
    );
    const { result } = renderHook(() => useLogout());

    act(() => {
      void result.current[0]();
    });
    await waitFor(() => expect(result.current[1]).toBe(true));
    await act(async () => {
      release();
    });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  // The real `logout()` helper is designed never to throw (it swallows its
  // own fetch failure internally), so this can't happen with the real
  // helper — but the hook's `finally { setLoading(false) }` is still live
  // defensive code, and it's cheap to prove it holds even if that contract
  // is ever violated.
  it('still resets loading to false if the helper rejects', async () => {
    vi.spyOn(logoutModule, 'logout').mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useLogout());

    await act(async () => {
      await expect(result.current[0]()).rejects.toThrow('boom');
    });

    expect(result.current[1]).toBe(false);
  });
});

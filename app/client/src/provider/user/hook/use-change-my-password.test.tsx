import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChangeMyPassword } from '.';

describe('useChangeMyPassword', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns changeMyPassword function and initial false/undefined state', () => {
    const { result } = renderHook(() => useChangeMyPassword());
    const [changeMyPassword, loading, okay, error, errorMessage] = result.current;
    expect(typeof changeMyPassword).toBe('function');
    expect(loading).toBe(false);
    expect(okay).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('sets error when currentPassword is empty', async () => {
    const { result } = renderHook(() => useChangeMyPassword());
    await act(() => result.current[0]('', 'newpass'));
    expect(result.current[3]).toBe(true);
    expect(result.current[4]).toBe('Current and new password are required');
  });

  it('sets error when newPassword is empty', async () => {
    const { result } = renderHook(() => useChangeMyPassword());
    await act(() => result.current[0]('currentpass', ''));
    expect(result.current[3]).toBe(true);
    expect(result.current[4]).toBe('Current and new password are required');
  });

  it('sends PATCH to /api/my/password with currentPassword and newPassword', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const { result } = renderHook(() => useChangeMyPassword());
    await act(() => result.current[0]('oldpass', 'newpass'));
    expect(fetch).toHaveBeenCalledWith('/api/my/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'oldpass', newPassword: 'newpass' }),
    });
  });

  it('sets okay to true on 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const { result } = renderHook(() => useChangeMyPassword());
    await act(() => result.current[0]('oldpass', 'newpass'));
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe(false);
  });

  it('sets error when server returns non-204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401 }));
    const { result } = renderHook(() => useChangeMyPassword());
    await act(() => result.current[0]('wrongpass', 'newpass'));
    expect(result.current[2]).toBe(false);
    expect(result.current[3]).toBe(true);
    expect(result.current[4]).toBe('Password change failed');
  });

  it('sets error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const { result } = renderHook(() => useChangeMyPassword());
    await act(() => result.current[0]('oldpass', 'newpass'));
    expect(result.current[3]).toBe(true);
    expect(result.current[4]).toBe('Network error');
  });

  it('sets loading to true while PATCH is pending', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );
    const { result } = renderHook(() => useChangeMyPassword());
    act(() => {
      void result.current[0]('oldpass', 'newpass');
    });
    expect(result.current[1]).toBe(true);
    resolveFetch({ status: 204 });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });
});

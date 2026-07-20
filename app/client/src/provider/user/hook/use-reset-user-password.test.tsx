import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { useResetUserPassword } from './use-reset-user-password';

describe('useResetUserPassword', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls POST and returns the new password', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200,
      json: async () => ({ password: 'k4tWc9pLxQ2mAbCd' }),
    } as Response);

    const { result } = renderHook(() => useResetUserPassword());
    let returned: string | null = null;
    await act(async () => {
      returned = await result.current[0]('alice');
    });

    expect(returned).toBe('k4tWc9pLxQ2mAbCd');
    expect(fetch).toHaveBeenCalledWith('/api/users/alice/reset-password', { method: 'POST' });
    expect(result.current[1]).toBe(false);
    expect(result.current[2]).toBe(false);
  });

  it('sets error and returns null on non-200 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ status: 404 } as Response);

    const { result } = renderHook(() => useResetUserPassword());
    let returned: string | null = null;
    await act(async () => {
      returned = await result.current[0]('nobody');
    });

    expect(returned).toBeNull();
    expect(result.current[2]).toBe(true);
  });

  it('sets loading true while request is pending', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );

    const { result } = renderHook(() => useResetUserPassword());
    act(() => {
      void result.current[0]('alice');
    });
    expect(result.current[1]).toBe(true);

    resolveFetch({ status: 200, json: async () => ({ password: 'k4tWc9pLxQ2mAbCd' }) });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });
});

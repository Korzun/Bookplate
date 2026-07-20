import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { useRegenerateSyncPassword } from './use-regenerate-sync-password';

describe('useRegenerateSyncPassword', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls POST and returns the new syncPassword', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200,
      json: async () => ({ syncPassword: 'swift stone' }),
    } as Response);

    const { result } = renderHook(() => useRegenerateSyncPassword());
    act(() => {
      void result.current[0]();
    });
    await waitFor(() => expect(result.current[2]).toBe('swift stone'));
    expect(result.current[1]).toBe(false);
    expect(result.current[3]).toBe(false);
  });

  it('sets error on non-200 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ status: 500 } as Response);
    const { result } = renderHook(() => useRegenerateSyncPassword());
    act(() => {
      void result.current[0]();
    });
    await waitFor(() => expect(result.current[3]).toBe(true));
    expect(result.current[2]).toBeNull();
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
    const { result } = renderHook(() => useRegenerateSyncPassword());
    act(() => {
      void result.current[0]();
    });
    expect(result.current[1]).toBe(true);
    resolveFetch({ status: 200, json: async () => ({ syncPassword: 'bold pine' }) });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });
});

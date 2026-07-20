import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { useSyncPassword } from './use-sync-password';

describe('useSyncPassword', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and returns syncPassword on mount', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200,
      json: async () => ({ syncPassword: 'blue oak' }),
    } as Response);

    const { result } = renderHook(() => useSyncPassword());
    await waitFor(() => expect(result.current[0]).toBe('blue oak'));
    expect(result.current[1]).toBe(false); // not loading
    expect(result.current[2]).toBe(false); // no error
  });

  it('sets error on non-200 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ status: 500 } as Response);
    const { result } = renderHook(() => useSyncPassword());
    await waitFor(() => expect(result.current[2]).toBe(true));
    expect(result.current[0]).toBeNull();
  });

  it('sets loading true while fetching', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((r) => {
          resolveFetch = r;
        })
      )
    );
    const { result } = renderHook(() => useSyncPassword());
    expect(result.current[1]).toBe(true);
    resolveFetch({ status: 200, json: async () => ({ syncPassword: 'red hawk' }) });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });
});

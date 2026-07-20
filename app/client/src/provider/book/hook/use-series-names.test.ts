import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSeriesNames } from './use-series-names';

describe('useSeriesNames', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches GET /api/series on mount and returns the names in server order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ series: ['Expanse', 'A Banner', 'The Zone'] }),
      })
    );
    const { result } = renderHook(() => useSeriesNames());
    await waitFor(() => expect(result.current[0]).toEqual(['Expanse', 'A Banner', 'The Zone']));
    expect(fetch).toHaveBeenCalledWith('/api/series', expect.anything());
  });

  it('starts with loading true', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() => useSeriesNames());
    expect(result.current[1]).toBe(true);
  });

  it('sets loading false after fetch completes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ series: [] }),
      })
    );
    const { result } = renderHook(() => useSeriesNames());
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  it('sets error string on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderHook(() => useSeriesNames());
    await waitFor(() => expect(result.current[2]).toBe('Failed to fetch series'));
  });

  it('returns empty array by default', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() => useSeriesNames());
    expect(result.current[0]).toEqual([]);
  });
});

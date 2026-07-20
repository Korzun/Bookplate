import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { useBookLineage } from './use-book-lineage';

afterEach(() => vi.unstubAllGlobals());

describe('useBookLineage', () => {
  it('returns loading initially', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() => useBookLineage('book-1'));
    const [data, loading, error, refetch] = result.current;
    expect(data).toBeUndefined();
    expect(loading).toBe(true);
    expect(error).toBe(false);
    expect(typeof refetch).toBe('function');
  });

  it('returns lineage data including type on success', async () => {
    const lineage = {
      currentId: 'book-1',
      entries: [{ oldId: 'old-1', newId: 'book-1', timestamp: 1000, type: 'edit' }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(lineage) })
    );

    const { result } = renderHook(() => useBookLineage('book-1'));
    await waitFor(() => expect(result.current[1]).toBe(false));

    const [data, loading, error] = result.current;
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(data?.currentId).toBe('book-1');
    expect(data?.entries[0].type).toBe('edit');
  });

  it('returns error state on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useBookLineage('book-1'));
    await waitFor(() => expect(result.current[2]).toBe(true));

    expect(result.current[0]).toBeUndefined();
    expect(result.current[1]).toBe(false);
  });

  it('refetch re-triggers the fetch', async () => {
    const lineage = { currentId: 'book-1', entries: [] };
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(lineage) });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useBookLineage('book-1'));
    await waitFor(() => expect(result.current[1]).toBe(false));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    act(() => result.current[3]());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });
});

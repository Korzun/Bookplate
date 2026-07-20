import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { useLibrarySubjects } from './use-library-subjects';

describe('useLibrarySubjects', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches GET /api/subjects on mount and returns subjects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ subjects: ['Fiction', 'History'] }),
      })
    );
    const { result } = renderHook(() => useLibrarySubjects());
    await waitFor(() => expect(result.current[0]).toEqual(['Fiction', 'History']));
    expect(fetch).toHaveBeenCalledWith('/api/subjects', expect.anything());
  });

  it('starts with loading true', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() => useLibrarySubjects());
    expect(result.current[1]).toBe(true);
  });

  it('sets loading false after fetch completes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ subjects: [] }),
      })
    );
    const { result } = renderHook(() => useLibrarySubjects());
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  it('sets error string on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderHook(() => useLibrarySubjects());
    await waitFor(() => expect(result.current[2]).toBe('Failed to fetch subjects'));
  });

  it('returns empty array by default', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() => useLibrarySubjects());
    expect(result.current[0]).toEqual([]);
  });
});

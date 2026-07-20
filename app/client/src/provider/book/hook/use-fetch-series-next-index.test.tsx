import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFetchSeriesNextIndex } from './use-fetch-series-next-index';

vi.mock('~/provider/library-target', () => ({
  useWithTargetUser: () => (url: string) => url,
}));

const fetchMock = vi.fn();
vi.mock('~/lib/api-fetch', () => ({
  apiFetch: (url: string) => fetchMock(url),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('useFetchSeriesNextIndex', () => {
  it('requests the encoded series name and returns nextIndex', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ nextIndex: 4 }) });
    const { result } = renderHook(() => useFetchSeriesNextIndex());
    await expect(result.current('The Expanse')).resolves.toBe(4);
    expect(fetchMock).toHaveBeenCalledWith('/api/series/The%20Expanse/next-index');
  });

  it('throws when the response is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useFetchSeriesNextIndex());
    await expect(result.current('Dune')).rejects.toThrow();
  });
});

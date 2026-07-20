import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { useSeries } from './use-series';

const mockWithTargetUser = (url: string) => url;

vi.mock('~/provider/library-target', () => ({
  useWithTargetUser: () => mockWithTargetUser,
}));

vi.mock('~/lib/api-fetch');

const makeMeta = () => ({
  name: 'Dune',
  subjects: ['Science Fiction', 'Politics'],
  bookCount: 2,
  author: 'Frank Herbert',
  publisher: 'Chilton',
  totalPages: 668,
  totalSize: 2097152,
});

describe('useSeries', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { apiFetch } = await import('~/lib/api-fetch');
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(JSON.stringify(makeMeta()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts in loading state', async () => {
    const { apiFetch } = await import('~/lib/api-fetch');
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {})); // never settles — no state update after test
    const { result } = renderHook(() => useSeries('Dune'));
    const [data, loading, error] = result.current;
    expect(data).toBeUndefined();
    expect(loading).toBe(true);
    expect(error).toBe(false);
  });

  it('returns series data on successful fetch', async () => {
    const { result } = renderHook(() => useSeries('Dune'));

    await waitFor(() => {
      expect(result.current[1]).toBe(false);
    });

    const [data, loading, error] = result.current;
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(data?.name).toBe('Dune');
    expect(data?.bookCount).toBe(2);
    expect(data?.subjects).toEqual(['Science Fiction', 'Politics']);
    expect(data?.author).toBe('Frank Herbert');
    expect(data?.publisher).toBe('Chilton');
    expect(data?.totalPages).toBe(668);
    expect(data?.totalSize).toBe(2097152);
  });

  it('returns error state when fetch fails', async () => {
    const { apiFetch } = await import('~/lib/api-fetch');
    vi.mocked(apiFetch).mockResolvedValue(new Response('', { status: 404 }));

    const { result } = renderHook(() => useSeries('Dune'));

    await waitFor(() => {
      expect(result.current[1]).toBe(false);
    });

    const [data, loading, error, errorMessage] = result.current;
    expect(data).toBeUndefined();
    expect(loading).toBe(false);
    expect(error).toBe(true);
    expect(errorMessage).toBe('Series not found');
  });

  it('returns error state when fetch throws', async () => {
    const { apiFetch } = await import('~/lib/api-fetch');
    vi.mocked(apiFetch).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSeries('Dune'));

    await waitFor(() => {
      expect(result.current[1]).toBe(false);
    });

    const [, , error, errorMessage] = result.current;
    expect(error).toBe(true);
    expect(errorMessage).toBe('Network error');
  });

  it('re-fetches when seriesName changes', async () => {
    const { apiFetch } = await import('~/lib/api-fetch');

    const { result, rerender } = renderHook(({ name }) => useSeries(name), {
      initialProps: { name: 'Dune' },
    });

    await waitFor(() => {
      expect(result.current[1]).toBe(false);
    });
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);

    rerender({ name: 'Foundation' });

    await waitFor(() => {
      const callCount = vi.mocked(apiFetch).mock.calls.length;
      expect(callCount).toBe(2);
    });
  });
});

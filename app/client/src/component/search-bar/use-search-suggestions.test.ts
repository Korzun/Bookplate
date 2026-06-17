import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '~/lib/api-fetch';
import type { BookListFilter } from '~/provider/book';

import { useSearchSuggestions } from './use-search-suggestions';

// useWithTargetUser must return a stable function reference across renders.
// An arrow literal inside the factory would create a new function on every
// render call, making `withTargetUser` appear to change on every render and
// triggering an infinite useEffect re-run loop.
vi.mock('~/provider/library-target', () => {
  const identity = (url: string) => url;
  return { useWithTargetUser: () => identity };
});

vi.mock('~/lib/api-fetch');

const makeResponse = (groups: unknown[]) =>
  new Response(JSON.stringify({ groups }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const emptyFilter: BookListFilter = {};

// waitFor's internal polling uses setInterval — with fully-faked timers it
// never advances, causing OOM. shouldAdvanceTime lets real time advance so
// polling resolves without us manually ticking.
const fakeTimerOpts = { shouldAdvanceTime: true } as const;

describe('useSearchSuggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers(fakeTimerOpts);
    vi.clearAllMocks();
    vi.mocked(apiFetch).mockResolvedValue(makeResponse([]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty groups and loading=false when inputValue is empty', () => {
    const { result } = renderHook(() => useSearchSuggestions('', emptyFilter));
    expect(result.current.groups).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });

  it('does not fire a request before the 200ms debounce elapses', async () => {
    renderHook(() => useSearchSuggestions('jemi', emptyFilter));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });

  it('fires a request after 200ms', async () => {
    renderHook(() => useSearchSuggestions('jemi', emptyFilter));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
  });

  it('sets loading=true after debounce fires and before response arrives', async () => {
    let resolve!: (r: Response) => void;
    vi.mocked(apiFetch).mockImplementation(
      () =>
        new Promise<Response>((res) => {
          resolve = res;
        })
    );
    const { result, unmount } = renderHook(() => useSearchSuggestions('jemi', emptyFilter));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.loading).toBe(true);
    unmount();
    resolve(makeResponse([])); // release the pending promise to avoid leak
  });

  it('sets loading=false after response arrives', async () => {
    vi.mocked(apiFetch).mockResolvedValue(makeResponse([]));
    const { result } = renderHook(() => useSearchSuggestions('jemi', emptyFilter));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('prepends status group from client-side match before server groups', async () => {
    vi.mocked(apiFetch).mockResolvedValue(makeResponse([]));
    const { result } = renderHook(() => useSearchSuggestions('in pr', emptyFilter));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const statusGroup = result.current.groups.find((g) => g.type === 'status');
    expect(statusGroup).toBeDefined();
    expect(statusGroup!.items).toHaveLength(1);
    expect(statusGroup!.items[0].value).toBe('in-progress');
    expect(statusGroup!.items[0].additive).toBe(false);
  });

  it('omits status group when filter.status is already set', async () => {
    vi.mocked(apiFetch).mockResolvedValue(makeResponse([]));
    const { result } = renderHook(() => useSearchSuggestions('in pr', { status: 'in-progress' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups.find((g) => g.type === 'status')).toBeUndefined();
  });

  it('maps server author group and computes matchStart/matchLength', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      makeResponse([{ type: 'author', items: [{ label: 'N.K. Jemisin', value: 'N.K. Jemisin' }] }])
    );
    const { result } = renderHook(() => useSearchSuggestions('jemi', emptyFilter));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const authorGroup = result.current.groups.find((g) => g.type === 'author');
    expect(authorGroup?.items[0].matchStart).toBe(5); // 'jemi' in 'n.k. jemisin' at index 5
    expect(authorGroup?.items[0].matchLength).toBe(4);
    expect(authorGroup?.items[0].additive).toBe(false);
  });

  it('marks subject items as additive=true', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      makeResponse([{ type: 'subject', items: [{ label: 'Fantasy', value: 'Fantasy' }] }])
    );
    const { result } = renderHook(() => useSearchSuggestions('fan', emptyFilter));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const subjectGroup = result.current.groups.find((g) => g.type === 'subject');
    expect(subjectGroup?.items[0].additive).toBe(true);
  });

  it('sends active filter chips as query params', async () => {
    vi.mocked(apiFetch).mockResolvedValue(makeResponse([]));
    const { result } = renderHook(() =>
      useSearchSuggestions('fan', { author: 'N.K. Jemisin', subjects: ['Fantasy'] })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const url = vi.mocked(apiFetch).mock.calls[0][0] as string;
    expect(url).toContain('q=fan');
    expect(url).toContain('author=N.K.+Jemisin');
    expect(url).toContain('subjects=Fantasy');
  });

  it('resets groups to [] when inputValue becomes empty', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      makeResponse([{ type: 'author', items: [{ label: 'N.K. Jemisin', value: 'N.K. Jemisin' }] }])
    );
    const { result, rerender } = renderHook(
      ({ input }: { input: string }) => useSearchSuggestions(input, emptyFilter),
      { initialProps: { input: 'jemi' } }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current.groups.length).toBeGreaterThan(0));

    rerender({ input: '' });
    expect(result.current.groups).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});

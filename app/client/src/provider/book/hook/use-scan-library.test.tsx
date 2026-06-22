import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { BookList } from '../type';

function makeWrapper(clearCompleteBookIds: () => void = () => {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [bookList, setBookListRaw] = useState<BookList>({});
    const [bookListLoading, setBookListLoadingState] = useState(false);

    const setBookList = useCallback(
      (updater: (prev: BookList) => BookList) => setBookListRaw(updater),
      []
    );
    const setBookListLoading = useCallback((v: boolean) => setBookListLoadingState(v), []);

    return (
      <Context.Provider
        value={{
          bookList,
          bookListFetched: false,
          bookListLoading,
          bookListError: undefined,
          loadingByBookId: {},
          errorByBookId: {},
          completeBookIds: new Set(),
          setBookList,
          setBookListFetched: () => {},
          setBookListLoading,
          setBookListError: () => {},
          setLoadingForBook: () => {},
          setErrorForBook: () => {},
          setBookComplete: () => {},
          clearCompleteBookIds,
          bookListItems: [],
          nextCursor: null,
          setBookListItems: () => {},
          setNextCursor: () => {},
          bookListFilter: {},
          setBookListFilter: () => {},
        }}
      >
        {children}
      </Context.Provider>
    );
  };
}

import { useScanLibrary } from './use-scan-library';

// Helpers to build fetch responses.
const ok = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
const accepted = (body: unknown) => ({ ok: true, status: 202, json: () => Promise.resolve(body) });

describe('useScanLibrary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('on mount, checks status and stays idle when no scan is running', async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok({ status: 'idle' }));
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useScanLibrary(), { wrapper: makeWrapper() });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockFetch).toHaveBeenCalledWith('/api/books/scan/status', {});
    expect(result.current[2]).toBe(false); // not loading
  });

  it('starts a scan, polls to completion, and clears complete book ids', async () => {
    const mockClear = vi.fn();
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ status: 'idle' })) // mount status check
      .mockResolvedValueOnce(accepted({ jobId: 'j1', status: 'running', startedAt: 1 })) // POST
      .mockResolvedValueOnce(
        ok({
          jobId: 'j1',
          status: 'completed',
          startedAt: 1,
          result: { imported: ['x'], removed: [] },
        })
      ); // first poll
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useScanLibrary(), { wrapper: makeWrapper(mockClear) });
    await vi.advanceTimersByTimeAsync(0); // resolve mount status

    let scanPromise!: Promise<unknown>;
    act(() => {
      scanPromise = result.current[0]();
    });
    await vi.advanceTimersByTimeAsync(0); // POST resolves
    await vi.advanceTimersByTimeAsync(2000); // first poll fires
    await act(async () => {
      await scanPromise;
    });

    expect(mockClear).toHaveBeenCalled();
    expect(result.current[1]).toEqual({ imported: ['x'], removed: [] }); // scanResult
    expect(result.current[2]).toBe(false); // loading cleared
  });

  it('sets error when the POST is rejected', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ status: 'idle' })) // mount
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) }); // POST
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useScanLibrary(), { wrapper: makeWrapper() });
    await vi.advanceTimersByTimeAsync(0);

    let scanPromise!: Promise<unknown>;
    act(() => {
      scanPromise = result.current[0]();
    });
    await act(async () => {
      await scanPromise;
    });

    expect(result.current[3]).toBe(true); // error
  });

  it('does not start a second scan while one is in progress', async () => {
    // mount = idle; POST = 202; status polls never complete (stay running).
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ status: 'idle' }))
      .mockResolvedValueOnce(accepted({ jobId: 'j1', status: 'running', startedAt: 1 }))
      .mockResolvedValue(ok({ jobId: 'j1', status: 'running', startedAt: 1 }));
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useScanLibrary(), { wrapper: makeWrapper() });
    await vi.advanceTimersByTimeAsync(0); // mount status

    await act(async () => {
      void result.current[0]();
      await vi.advanceTimersByTimeAsync(0); // POST resolves, loading true
    });
    // Assert loading without awaiting the never-terminating poll; cleanup cancels it.
    expect(result.current[2]).toBe(true);

    const postCalls = () =>
      mockFetch.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(postCalls()).toHaveLength(1);

    await act(async () => {
      await result.current[0](); // second call — should be a no-op
    });
    expect(postCalls()).toHaveLength(1);
  });

  it('treats idle status mid-poll as terminal: resolves to null and clears loading', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ status: 'idle' })) // mount status check
      .mockResolvedValueOnce(accepted({ jobId: 'j1', status: 'running', startedAt: 1 })) // POST
      .mockResolvedValueOnce(ok({ status: 'idle' })); // poll: job vanished after server restart
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useScanLibrary(), { wrapper: makeWrapper() });
    await vi.advanceTimersByTimeAsync(0); // resolve mount status

    let scanPromise!: Promise<unknown>;
    act(() => {
      scanPromise = result.current[0]();
    });
    await vi.advanceTimersByTimeAsync(0); // POST resolves
    await vi.advanceTimersByTimeAsync(2000); // first poll fires → returns idle

    let resolved: unknown;
    await act(async () => {
      resolved = await scanPromise;
    });

    expect(resolved).toBeNull(); // resolves (no hang)
    expect(result.current[2]).toBe(false); // loading cleared
    expect(result.current[3]).toBe(false); // no error set
  });

  it('attaches to an already-running scan on mount and shows loading', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ jobId: 'j1', status: 'running', startedAt: 1 })) // mount: running
      .mockResolvedValue(ok({ jobId: 'j1', status: 'running', startedAt: 1 })); // polls keep running
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useScanLibrary(), { wrapper: makeWrapper() });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // mount status resolves → running, loading set
    });
    // Assert loading without awaiting the never-terminating poll; cleanup cancels it.
    expect(result.current[2]).toBe(true); // loading from mount attach
  });
});

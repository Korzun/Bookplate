import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { Context as AuthContext } from '../../auth/context';
import type { AuthContext as AuthContextType } from '../../auth/context';
import { Context } from '../context';
import type { ProgressList, UserProgressList } from '../type';

import { useUserProgressList } from './use-user-progress-list';

function makeAuthValue(): AuthContextType {
  return {
    username: 'alice',
    userId: undefined,
    isAdmin: true,
    loading: false,
    mustChangePassword: false,
  };
}

function makeWrapper(initialProgress: ProgressList = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [progressList, setProgressListRaw] = useState<ProgressList>(initialProgress);
    const [loadingByUsername, setLoadingByUsernameRaw] = useState<Record<string, boolean>>({});
    const [errorByUsername, setErrorByUsernameRaw] = useState<Record<string, string | undefined>>(
      {}
    );

    const setProgressForUsername = useCallback((username: string, data: UserProgressList) => {
      setProgressListRaw((prev) => ({ ...prev, [username]: data }));
    }, []);
    const setLoadingForUsername = useCallback((username: string, loading: boolean) => {
      setLoadingByUsernameRaw((prev) => ({ ...prev, [username]: loading }));
    }, []);
    const setErrorForUsername = useCallback((username: string, error: string | undefined) => {
      setErrorByUsernameRaw((prev) => ({ ...prev, [username]: error }));
    }, []);

    return (
      <AuthContext.Provider value={makeAuthValue()}>
        <Context.Provider
          value={{
            progressList,
            loadingByUsername,
            errorByUsername,
            setProgressForUsername,
            setLoadingForUsername,
            setErrorForUsername,
            renameProgressKey: () => {},
          }}
        >
          {children}
        </Context.Provider>
      </AuthContext.Provider>
    );
  };
}

describe('useUserProgressList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns undefined and false states when username is undefined', () => {
    const { result } = renderHook(() => useUserProgressList(undefined), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual([undefined, false, false, undefined]);
  });

  it('returns data already in context without fetching', () => {
    const existingProgress: UserProgressList = { 'book-1': { document: 'book-1', percentage: 50 } };
    const { result } = renderHook(() => useUserProgressList('alice'), {
      wrapper: makeWrapper({ alice: existingProgress }),
    });
    expect(result.current[0]).toEqual(existingProgress);
    expect(result.current[1]).toBe(false);
    expect(result.current[2]).toBe(false);
  });

  it('triggers a fetch on mount when data is absent', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ items: [{ document: 'book-1', percentage: 75 }], nextCursor: null }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useUserProgressList('alice'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current[1]).toBe(false));
    expect(mockFetch).toHaveBeenCalledWith('/api/users/alice/progress', {});
    expect(result.current[0]).toEqual({ 'book-1': { document: 'book-1', percentage: 75 } });
  });

  it('shows loading state while fetch is in flight', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );

    const { result } = renderHook(() => useUserProgressList('alice'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current[1]).toBe(true));
    resolveFetch({ ok: true, json: () => Promise.resolve({ items: [], nextCursor: null }) });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  it('returns error state on failed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useUserProgressList('alice'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current[2]).toBe(true));
    expect(result.current[3]).toBe('Failed to fetch progress');
  });

  it('does not re-fetch if data is already in context', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const existingProgress: UserProgressList = { 'book-1': { document: 'book-1', percentage: 50 } };

    renderHook(() => useUserProgressList('alice'), {
      wrapper: makeWrapper({ alice: existingProgress }),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('concurrent fetches for different usernames both persist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const username = decodeURIComponent((url as string).split('/')[3]);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [{ document: `book-${username}`, percentage: 50 }],
              nextCursor: null,
            }),
        });
      })
    );

    const { result } = renderHook(
      () => ({
        alice: useUserProgressList('alice'),
        bob: useUserProgressList('bob'),
      }),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => {
      expect(result.current.alice[1]).toBe(false);
      expect(result.current.bob[1]).toBe(false);
    });

    // Both datasets survive — this is the regression test for the stale-closure race
    expect(result.current.alice[0]).toEqual({
      'book-alice': { document: 'book-alice', percentage: 50 },
    });
    expect(result.current.bob[0]).toEqual({ 'book-bob': { document: 'book-bob', percentage: 50 } });
  });

  it('deduplicates entries with the same document id, keeping the last occurrence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              { document: 'book-1', percentage: 0.5 },
              { document: 'book-1', percentage: 0.9 },
            ],
            nextCursor: null,
          }),
      })
    );
    const { result } = renderHook(() => useUserProgressList('alice'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current[1]).toBe(false));
    expect(Object.keys(result.current[0]!)).toHaveLength(1);
    expect(result.current[0]!['book-1'].percentage).toBe(0.9);
  });
});

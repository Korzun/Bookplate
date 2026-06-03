import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context as AuthContext } from '../../auth/context';
import type { AuthContext as AuthContextType } from '../../auth/context';
import { Context as ProgressContext } from '../context';
import type { ProgressList, UserProgressList } from '../type';

import { useMyProgressList } from './use-my-progress-list';

function makeAuthValue(overrides: { username?: string } = {}): AuthContextType {
  return {
    username: overrides.username,
    isAdmin: false,
    loading: false,
    error: false,
    errorMessage: undefined,
    setUsername: () => {},
    setIsAdmin: () => {},
    refetch: () => Promise.resolve(),
  } as AuthContextType;
}

function makeWrapper(initialProgress: ProgressList = {}, auth: { username?: string } = {}) {
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
      <AuthContext.Provider value={makeAuthValue(auth)}>
        <ProgressContext.Provider
          value={{
            progressList,
            loadingByUsername,
            errorByUsername,
            setProgressForUsername,
            setLoadingForUsername,
            setErrorForUsername,
          }}
        >
          {children}
        </ProgressContext.Provider>
      </AuthContext.Provider>
    );
  };
}

describe('useMyProgressList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns error state when username is undefined', () => {
    const { result } = renderHook(() => useMyProgressList(), {
      wrapper: makeWrapper({}, { username: undefined }),
    });
    expect(result.current).toEqual([undefined, false, true, 'User not logged in']);
  });

  it('returns data already in context without fetching', () => {
    const existing: UserProgressList = { 'book-1': { document: 'book-1', percentage: 50 } };
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useMyProgressList(), {
      wrapper: makeWrapper({ alice: existing }, { username: 'alice' }),
    });
    expect(result.current[0]).toEqual(existing);
    expect(result.current[1]).toBe(false);
    expect(result.current[2]).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('triggers a fetch when data is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{ document: 'book-1', percentage: 80 }]),
      })
    );
    const { result } = renderHook(() => useMyProgressList(), {
      wrapper: makeWrapper({}, { username: 'alice' }),
    });
    await waitFor(() => expect(result.current[1]).toBe(false));
    expect(fetch).toHaveBeenCalledWith('/api/my/progress');
    expect(result.current[0]).toEqual({ 'book-1': { document: 'book-1', percentage: 80 } });
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
    const { result } = renderHook(() => useMyProgressList(), {
      wrapper: makeWrapper({}, { username: 'alice' }),
    });
    await waitFor(() => expect(result.current[1]).toBe(true));
    resolveFetch({ ok: true, json: () => Promise.resolve([]) });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  it('returns error state on failed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderHook(() => useMyProgressList(), {
      wrapper: makeWrapper({}, { username: 'alice' }),
    });
    await waitFor(() => expect(result.current[2]).toBe(true));
    expect(result.current[3]).toBe('Failed to fetch progress');
  });

  it('does not re-fetch if data is already in context', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const existing: UserProgressList = { 'book-1': { document: 'book-1', percentage: 50 } };
    renderHook(() => useMyProgressList(), {
      wrapper: makeWrapper({ alice: existing }, { username: 'alice' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('deduplicates entries with the same document id, keeping the last occurrence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { document: 'book-1', percentage: 0.5 },
            { document: 'book-1', percentage: 0.9 },
          ]),
      })
    );
    const { result } = renderHook(() => useMyProgressList(), {
      wrapper: makeWrapper({}, { username: 'alice' }),
    });
    await waitFor(() => expect(result.current[1]).toBe(false));
    expect(Object.keys(result.current[0]!)).toHaveLength(1);
    expect(result.current[0]!['book-1'].percentage).toBe(0.9);
  });
});

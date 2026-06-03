import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context as AuthContext } from '../../auth/context';
import type { AuthContext as AuthContextType } from '../../auth/context';
import { Context as ProgressContext } from '../context';
import type { UserProgressList } from '../type';

import { useFetchMyProgressList } from './use-fetch-my-progress-list';

function makeAuthValue(overrides: { username?: string; isAdmin?: boolean } = {}): AuthContextType {
  return {
    username: overrides.username,
    isAdmin: overrides.isAdmin ?? false,
    loading: false,
    error: false,
    errorMessage: undefined,
    setUsername: () => {},
    setIsAdmin: () => {},
    refetch: () => Promise.resolve(),
  } as AuthContextType;
}

function makeWrapper({
  auth = {},
  setProgressForUsername = vi.fn(),
  setLoadingForUsername = vi.fn(),
  setErrorForUsername = vi.fn(),
  loadingByUsername = {},
}: {
  auth?: { username?: string; isAdmin?: boolean };
  setProgressForUsername?: (username: string, data: UserProgressList) => void;
  setLoadingForUsername?: (username: string, loading: boolean) => void;
  setErrorForUsername?: (username: string, error: string | undefined) => void;
  loadingByUsername?: Record<string, boolean>;
} = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider value={makeAuthValue(auth)}>
        <ProgressContext.Provider
          value={{
            progressList: {},
            loadingByUsername,
            errorByUsername: {},
            setProgressForUsername,
            setLoadingForUsername,
            setErrorForUsername,
            renameProgressKey: () => {},
          }}
        >
          {children}
        </ProgressContext.Provider>
      </AuthContext.Provider>
    );
  };
}

describe('useFetchMyProgressList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a function', () => {
    const { result } = renderHook(() => useFetchMyProgressList(), {
      wrapper: makeWrapper({ auth: { username: 'alice' } }),
    });
    expect(typeof result.current).toBe('function');
  });

  it('does nothing when isAdmin is true', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useFetchMyProgressList(), {
      wrapper: makeWrapper({ auth: { username: 'alice', isAdmin: true } }),
    });
    await result.current();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does nothing when username is undefined', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useFetchMyProgressList(), {
      wrapper: makeWrapper({ auth: { username: undefined } }),
    });
    await result.current();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does nothing when already loading for the user', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useFetchMyProgressList(), {
      wrapper: makeWrapper({
        auth: { username: 'alice' },
        loadingByUsername: { alice: true },
      }),
    });
    await result.current();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches /api/my/progress', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    );
    const { result } = renderHook(() => useFetchMyProgressList(), {
      wrapper: makeWrapper({ auth: { username: 'alice' } }),
    });
    await result.current();
    expect(fetch).toHaveBeenCalledWith('/api/my/progress');
  });

  it('calls setProgressForUsername with data keyed by document id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { document: 'book-1', percentage: 50 },
            { document: 'book-2', percentage: 75 },
          ]),
      })
    );
    const setProgressForUsername = vi.fn();
    const { result } = renderHook(() => useFetchMyProgressList(), {
      wrapper: makeWrapper({ auth: { username: 'alice' }, setProgressForUsername }),
    });
    await result.current();
    expect(setProgressForUsername).toHaveBeenCalledWith('alice', {
      'book-1': { document: 'book-1', percentage: 50 },
      'book-2': { document: 'book-2', percentage: 75 },
    });
  });

  it('calls setLoadingForUsername true then false around the fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    );
    const calls: [string, boolean][] = [];
    const setLoadingForUsername = vi.fn((u: string, l: boolean) => calls.push([u, l]));
    const { result } = renderHook(() => useFetchMyProgressList(), {
      wrapper: makeWrapper({ auth: { username: 'alice' }, setLoadingForUsername }),
    });
    await result.current();
    expect(calls).toEqual([
      ['alice', true],
      ['alice', false],
    ]);
  });

  it('calls setErrorForUsername with error message on failed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const setErrorForUsername = vi.fn();
    const { result } = renderHook(() => useFetchMyProgressList(), {
      wrapper: makeWrapper({ auth: { username: 'alice' }, setErrorForUsername }),
    });
    await result.current();
    expect(setErrorForUsername).toHaveBeenCalledWith('alice', 'Failed to fetch progress');
  });

  it('calls setErrorForUsername with error message on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')));
    const setErrorForUsername = vi.fn();
    const { result } = renderHook(() => useFetchMyProgressList(), {
      wrapper: makeWrapper({ auth: { username: 'alice' }, setErrorForUsername }),
    });
    await result.current();
    expect(setErrorForUsername).toHaveBeenCalledWith('alice', 'Timeout');
  });
});

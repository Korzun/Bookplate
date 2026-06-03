import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context as AuthContext } from '../../auth/context';
import type { AuthContext as AuthContextType } from '../../auth/context';
import { Context as ProgressContext } from '../context';
import type { UserProgressList } from '../type';

import { useFetchUserProgressList } from './use-fetch-user-progress-list';

function makeAuthValue(overrides: { isAdmin?: boolean } = {}): AuthContextType {
  return {
    username: 'alice',
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
  isAdmin = false,
  setProgressForUsername = vi.fn(),
  setLoadingForUsername = vi.fn(),
  setErrorForUsername = vi.fn(),
  loadingByUsername = {},
}: {
  isAdmin?: boolean;
  setProgressForUsername?: (username: string, data: UserProgressList) => void;
  setLoadingForUsername?: (username: string, loading: boolean) => void;
  setErrorForUsername?: (username: string, error: string | undefined) => void;
  loadingByUsername?: Record<string, boolean>;
} = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider value={makeAuthValue({ isAdmin })}>
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

describe('useFetchUserProgressList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a function', () => {
    const { result } = renderHook(() => useFetchUserProgressList(), {
      wrapper: makeWrapper(),
    });
    expect(typeof result.current).toBe('function');
  });

  it('does nothing when isAdmin is false', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useFetchUserProgressList(), {
      wrapper: makeWrapper({ isAdmin: false }),
    });
    await result.current('alice');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does nothing when already loading for the given username', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useFetchUserProgressList(), {
      wrapper: makeWrapper({ isAdmin: true, loadingByUsername: { alice: true } }),
    });
    await result.current('alice');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches /api/users/:username/progress', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    );
    const { result } = renderHook(() => useFetchUserProgressList(), {
      wrapper: makeWrapper({ isAdmin: true }),
    });
    await result.current('alice');
    expect(fetch).toHaveBeenCalledWith('/api/users/alice/progress');
  });

  it('URL-encodes the username in the endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    );
    const { result } = renderHook(() => useFetchUserProgressList(), {
      wrapper: makeWrapper({ isAdmin: true }),
    });
    await result.current('alice smith');
    expect(fetch).toHaveBeenCalledWith('/api/users/alice%20smith/progress');
  });

  it('calls setProgressForUsername with data keyed by document id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { document: 'book-1', percentage: 30, device: 'kindle', timestamp: 1000 },
            { document: 'book-2', percentage: 90 },
          ]),
      })
    );
    const setProgressForUsername = vi.fn();
    const { result } = renderHook(() => useFetchUserProgressList(), {
      wrapper: makeWrapper({ isAdmin: true, setProgressForUsername }),
    });
    await result.current('bob');
    expect(setProgressForUsername).toHaveBeenCalledWith('bob', {
      'book-1': { document: 'book-1', percentage: 30, device: 'kindle', timestamp: 1000 },
      'book-2': { document: 'book-2', percentage: 90 },
    });
  });

  it('calls setLoadingForUsername true then false around the fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    );
    const calls: [string, boolean][] = [];
    const setLoadingForUsername = vi.fn((u: string, l: boolean) => calls.push([u, l]));
    const { result } = renderHook(() => useFetchUserProgressList(), {
      wrapper: makeWrapper({ isAdmin: true, setLoadingForUsername }),
    });
    await result.current('alice');
    expect(calls).toEqual([
      ['alice', true],
      ['alice', false],
    ]);
  });

  it('calls setErrorForUsername with message on failed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const setErrorForUsername = vi.fn();
    const { result } = renderHook(() => useFetchUserProgressList(), {
      wrapper: makeWrapper({ isAdmin: true, setErrorForUsername }),
    });
    await result.current('alice');
    expect(setErrorForUsername).toHaveBeenCalledWith('alice', 'Failed to fetch progress');
  });

  it('calls setErrorForUsername with message on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));
    const setErrorForUsername = vi.fn();
    const { result } = renderHook(() => useFetchUserProgressList(), {
      wrapper: makeWrapper({ isAdmin: true, setErrorForUsername }),
    });
    await result.current('alice');
    expect(setErrorForUsername).toHaveBeenCalledWith('alice', 'Connection refused');
  });
});

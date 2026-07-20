import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { Context as AuthContext } from '../../auth/context';
import type { AuthContext as AuthContextType } from '../../auth/context';
import { Context as ProgressContext } from '../context';
import type { UserProgressList } from '../type';

import { useFetchMyProgressList } from './use-fetch-my-progress-list';

function makeAuthValue(overrides: { username?: string; isAdmin?: boolean } = {}): AuthContextType {
  return {
    username: overrides.username,
    userId: overrides.username ? 'test-user-id' : undefined,
    isAdmin: overrides.isAdmin ?? false,
    loading: false,
    mustChangePassword: false,
  };
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
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [], nextCursor: null }),
      })
    );
    const { result } = renderHook(() => useFetchMyProgressList(), {
      wrapper: makeWrapper({ auth: { username: 'alice' } }),
    });
    await result.current();
    expect(fetch).toHaveBeenCalledWith('/api/my/progress', {});
  });

  it('calls setProgressForUsername with data keyed by document id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              { document: 'book-1', percentage: 50 },
              { document: 'book-2', percentage: 75 },
            ],
            nextCursor: null,
          }),
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
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [], nextCursor: null }),
      })
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

  it('follows nextCursor across pages and merges into one dict', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ items: [{ document: 'a', percentage: 10 }], nextCursor: 'c1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ items: [{ document: 'b', percentage: 20 }], nextCursor: null }),
      });
    vi.stubGlobal('fetch', mockFetch);
    const setProgressForUsername = vi.fn();
    const { result } = renderHook(() => useFetchMyProgressList(), {
      wrapper: makeWrapper({ auth: { username: 'alice' }, setProgressForUsername }),
    });
    await result.current();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe('/api/my/progress?cursor=c1');
    expect(setProgressForUsername).toHaveBeenCalledTimes(1);
    expect(setProgressForUsername).toHaveBeenCalledWith('alice', {
      a: { document: 'a', percentage: 10 },
      b: { document: 'b', percentage: 20 },
    });
  });
});

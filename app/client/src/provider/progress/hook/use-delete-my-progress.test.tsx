import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { Context as AuthContext } from '../../auth/context';
import type { AuthContext as AuthContextType } from '../../auth/context';
import { Context as ProgressContext } from '../context';
import type { ProgressList, UserProgressList } from '../type';

import { useDeleteMyProgress } from './use-delete-my-progress';

function makeAuthValue(username: string | undefined): AuthContextType {
  return {
    username,
    userId: username ? 'test-user-id' : undefined,
    isAdmin: false,
    loading: false,
    mustChangePassword: false,
  };
}

function makeWrapper(initialProgress: ProgressList = {}, username?: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [progressList, setProgressListRaw] = useState<ProgressList>(initialProgress);
    const setProgressForUsername = useCallback((u: string, data: UserProgressList) => {
      setProgressListRaw((prev) => ({ ...prev, [u]: data }));
    }, []);

    return (
      <AuthContext.Provider value={makeAuthValue(username)}>
        <ProgressContext.Provider
          value={{
            progressList,
            loadingByUsername: {},
            errorByUsername: {},
            setProgressForUsername,
            setLoadingForUsername: () => {},
            setErrorForUsername: () => {},
            renameProgressKey: () => {},
          }}
        >
          {children}
        </ProgressContext.Provider>
      </AuthContext.Provider>
    );
  };
}

describe('useDeleteMyProgress', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns initial state', () => {
    const { result } = renderHook(() => useDeleteMyProgress(), {
      wrapper: makeWrapper(),
    });
    const [deleteMyProgress, deleting, error, errorMessage] = result.current;
    expect(typeof deleteMyProgress).toBe('function');
    expect(deleting).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('is a no-op and sets no error when username is undefined', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useDeleteMyProgress(), {
      wrapper: makeWrapper({}, undefined),
    });
    await act(() => result.current[0]('book-1'));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current[2]).toBe(false);
  });

  it('sends DELETE to the correct endpoint for the authenticated user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const { result } = renderHook(() => useDeleteMyProgress(), {
      wrapper: makeWrapper(
        { alice: { 'book-1': { document: 'book-1', percentage: 50 } } },
        'alice'
      ),
    });
    await act(() => result.current[0]('book-1'));
    expect(fetch).toHaveBeenCalledWith('/api/my/progress/book-1', { method: 'DELETE' });
  });

  it('reflects loading state while delete is in flight', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );
    const { result } = renderHook(() => useDeleteMyProgress(), {
      wrapper: makeWrapper(
        { alice: { 'book-1': { document: 'book-1', percentage: 50 } } },
        'alice'
      ),
    });
    act(() => {
      void result.current[0]('book-1');
    });
    expect(result.current[1]).toBe(true);
    resolveFetch({ status: 204 });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  it('reflects error state when DELETE fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Server down')));
    const { result } = renderHook(() => useDeleteMyProgress(), {
      wrapper: makeWrapper(
        { alice: { 'book-1': { document: 'book-1', percentage: 50 } } },
        'alice'
      ),
    });
    await act(() => result.current[0]('book-1'));
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Server down');
  });
});

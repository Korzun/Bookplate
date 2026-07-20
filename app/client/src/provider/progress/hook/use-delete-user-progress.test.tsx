import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { ProgressList, UserProgressList } from '../type';

import { useDeleteUserProgress } from './use-delete-user-progress';

function makeWrapper(initialProgress: ProgressList = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [progressList, setProgressListRaw] = useState<ProgressList>(initialProgress);
    const setProgressForUsername = useCallback((username: string, data: UserProgressList) => {
      setProgressListRaw((prev) => ({ ...prev, [username]: data }));
    }, []);
    return (
      <Context.Provider
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
      </Context.Provider>
    );
  };
}

describe('useDeleteUserProgress', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns initial state', () => {
    const { result } = renderHook(() => useDeleteUserProgress('alice'), {
      wrapper: makeWrapper(),
    });
    const [deleteUserProgress, deleting, error, errorMessage] = result.current;
    expect(typeof deleteUserProgress).toBe('function');
    expect(deleting).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('sets error when username is undefined', async () => {
    const { result } = renderHook(() => useDeleteUserProgress(undefined), {
      wrapper: makeWrapper(),
    });
    await act(() => result.current[0]('book-1'));
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Failed to delete progress');
  });

  it('sets error when user has no progress list', async () => {
    const { result } = renderHook(() => useDeleteUserProgress('alice'), {
      wrapper: makeWrapper(),
    });
    await act(() => result.current[0]('book-1'));
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Failed to delete progress');
  });

  it('sets error when bookId is not in the progress list', async () => {
    const { result } = renderHook(() => useDeleteUserProgress('alice'), {
      wrapper: makeWrapper({ alice: { 'book-2': { document: 'book-2', percentage: 50 } } }),
    });
    await act(() => result.current[0]('book-1'));
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Failed to delete progress');
  });

  it('sends DELETE to the correct endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const { result } = renderHook(() => useDeleteUserProgress('alice'), {
      wrapper: makeWrapper({ alice: { 'book-1': { document: 'book-1', percentage: 50 } } }),
    });
    await act(() => result.current[0]('book-1'));
    expect(fetch).toHaveBeenCalledWith('/api/users/alice/progress/book-1', { method: 'DELETE' });
  });

  it('URL-encodes username and bookId in the endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const username = 'alice smith';
    const bookId = 'book/1';
    const { result } = renderHook(() => useDeleteUserProgress(username), {
      wrapper: makeWrapper({ [username]: { [bookId]: { document: bookId, percentage: 10 } } }),
    });
    await act(() => result.current[0](bookId));
    expect(fetch).toHaveBeenCalledWith(
      `/api/users/${encodeURIComponent(username)}/progress/${encodeURIComponent(bookId)}`,
      { method: 'DELETE' }
    );
  });

  it('optimistically removes progress before fetch resolves', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );
    const { result } = renderHook(
      () => ({
        hook: useDeleteUserProgress('alice'),
        ctx: useContext(Context),
      }),
      { wrapper: makeWrapper({ alice: { 'book-1': { document: 'book-1', percentage: 50 } } }) }
    );
    act(() => {
      void result.current.hook[0]('book-1');
    });
    expect(result.current.ctx.progressList['alice']?.['book-1']).toBeUndefined();
    resolveFetch({ status: 204 });
    await waitFor(() => expect(result.current.hook[1]).toBe(false));
  });

  it('restores progress and sets error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const { result } = renderHook(
      () => ({
        hook: useDeleteUserProgress('alice'),
        ctx: useContext(Context),
      }),
      { wrapper: makeWrapper({ alice: { 'book-1': { document: 'book-1', percentage: 50 } } }) }
    );
    await act(() => result.current.hook[0]('book-1'));
    expect(result.current.ctx.progressList['alice']['book-1']).toEqual({
      document: 'book-1',
      percentage: 50,
    });
    expect(result.current.hook[2]).toBe(true);
    expect(result.current.hook[3]).toBe('Network error');
  });

  it('restores progress and sets error when response status is not 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500 }));
    const { result } = renderHook(
      () => ({
        hook: useDeleteUserProgress('alice'),
        ctx: useContext(Context),
      }),
      { wrapper: makeWrapper({ alice: { 'book-1': { document: 'book-1', percentage: 50 } } }) }
    );
    await act(() => result.current.hook[0]('book-1'));
    expect(result.current.ctx.progressList['alice']['book-1']).toEqual({
      document: 'book-1',
      percentage: 50,
    });
    expect(result.current.hook[2]).toBe(true);
    expect(result.current.hook[3]).toBe('Failed to clear progress');
  });

  it('sets loading to true while DELETE is in flight', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );
    const { result } = renderHook(() => useDeleteUserProgress('alice'), {
      wrapper: makeWrapper({ alice: { 'book-1': { document: 'book-1', percentage: 50 } } }),
    });
    act(() => {
      void result.current[0]('book-1');
    });
    expect(result.current[1]).toBe(true);
    resolveFetch({ status: 204 });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  it('is a no-op when already deleting', async () => {
    let resolveFetch!: (value: unknown) => void;
    const mockFetch = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useDeleteUserProgress('alice'), {
      wrapper: makeWrapper({ alice: { 'book-1': { document: 'book-1', percentage: 50 } } }),
    });
    act(() => {
      void result.current[0]('book-1');
    });
    await act(() => result.current[0]('book-1'));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    resolveFetch({ status: 204 });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });
});

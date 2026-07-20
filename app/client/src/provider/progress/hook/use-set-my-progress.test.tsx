import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context as AuthContext } from '../../auth/context';
import type { AuthContext as AuthContextType } from '../../auth/context';
import { Context as ProgressContext } from '../context';
import type { ProgressList, UserProgressList } from '../type';

import { useSetMyProgress } from './use-set-my-progress';

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

describe('useSetMyProgress', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('returns initial state', () => {
    const { result } = renderHook(() => useSetMyProgress('book-1'), {
      wrapper: makeWrapper({}, 'alice'),
    });
    const [setMyProgress, saving, error, errorMessage] = result.current;
    expect(typeof setMyProgress).toBe('function');
    expect(saving).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('is a no-op when username is undefined', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useSetMyProgress('book-1'), {
      wrapper: makeWrapper({}, undefined),
    });
    await act(() => result.current[0]({ currentChapter: 1, percentage: 10 }));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current[1]).toBe(false);
    expect(result.current[2]).toBe(false);
  });

  it('sends PUT to /api/my/progress/:bookId with JSON body', async () => {
    localStorage.setItem('bookplate-device-id', 'test-device-id');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { result } = renderHook(() => useSetMyProgress('book-1'), {
      wrapper: makeWrapper({}, 'alice'),
    });
    await act(() => result.current[0]({ currentChapter: 3, percentage: 0.5 }));
    expect(fetch).toHaveBeenCalledWith('/api/my/progress/book-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentChapter: 3,
        percentage: 0.5,
        device: 'Web',
        device_id: 'test-device-id',
      }),
    });
  });

  it('generates and persists a device ID in localStorage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { result } = renderHook(() => useSetMyProgress('book-1'), {
      wrapper: makeWrapper({}, 'alice'),
    });
    await act(() => result.current[0]({ currentChapter: 1, percentage: 0.1 }));
    const storedId = localStorage.getItem('bookplate-device-id');
    expect(storedId).toBeTruthy();
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.device_id).toBe(storedId);
    expect(body.device).toBe('Web');
  });

  it('reuses the same device ID across calls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { result } = renderHook(() => useSetMyProgress('book-1'), {
      wrapper: makeWrapper({}, 'alice'),
    });
    await act(() => result.current[0]({ currentChapter: 1, percentage: 0.1 }));
    await act(() => result.current[0]({ currentChapter: 2, percentage: 0.2 }));
    const calls = vi.mocked(fetch).mock.calls;
    const id1 = JSON.parse((calls[0][1] as RequestInit).body as string).device_id;
    const id2 = JSON.parse((calls[1][1] as RequestInit).body as string).device_id;
    expect(id1).toBe(id2);
  });

  it('URL-encodes bookId in the endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { result } = renderHook(() => useSetMyProgress('book/1'), {
      wrapper: makeWrapper({}, 'alice'),
    });
    await act(() => result.current[0]({ currentChapter: 1, percentage: 0.1 }));
    expect(fetch).toHaveBeenCalledWith(
      `/api/my/progress/${encodeURIComponent('book/1')}`,
      expect.any(Object)
    );
  });

  it('optimistically updates progress in context before fetch resolves', async () => {
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
        hook: useSetMyProgress('book-1'),
        ctx: useContext(ProgressContext),
      }),
      { wrapper: makeWrapper({}, 'alice') }
    );
    act(() => {
      void result.current.hook[0]({ currentChapter: 5, percentage: 0.5 });
    });
    expect(result.current.ctx.progressList['alice']?.['book-1']).toEqual({
      document: 'book-1',
      percentage: 0.5,
      currentChapter: 5,
    });
    resolveFetch({ ok: true });
    await waitFor(() => expect(result.current.hook[1]).toBe(false));
  });

  it('restores previous progress and sets error when PUT throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Server error')));
    const existing = { 'book-1': { document: 'book-1', percentage: 0.2, currentChapter: 2 } };
    const { result } = renderHook(
      () => ({
        hook: useSetMyProgress('book-1'),
        ctx: useContext(ProgressContext),
      }),
      { wrapper: makeWrapper({ alice: existing }, 'alice') }
    );
    await act(() => result.current.hook[0]({ currentChapter: 5, percentage: 0.5 }));
    expect(result.current.ctx.progressList['alice']['book-1']).toEqual(existing['book-1']);
    expect(result.current.hook[2]).toBe(true);
    expect(result.current.hook[3]).toBe('Server error');
  });

  it('restores previous progress and sets error on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const existing = { 'book-1': { document: 'book-1', percentage: 0.2, currentChapter: 2 } };
    const { result } = renderHook(
      () => ({
        hook: useSetMyProgress('book-1'),
        ctx: useContext(ProgressContext),
      }),
      { wrapper: makeWrapper({ alice: existing }, 'alice') }
    );
    await act(() => result.current.hook[0]({ currentChapter: 5, percentage: 0.5 }));
    expect(result.current.ctx.progressList['alice']['book-1']).toEqual(existing['book-1']);
    expect(result.current.hook[2]).toBe(true);
    expect(result.current.hook[3]).toBe('Failed to save progress');
  });

  it('sets saving to true while PUT is in flight', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );
    const { result } = renderHook(() => useSetMyProgress('book-1'), {
      wrapper: makeWrapper({}, 'alice'),
    });
    act(() => {
      void result.current[0]({ currentChapter: 1, percentage: 0.1 });
    });
    expect(result.current[1]).toBe(true);
    resolveFetch({ ok: true });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  it('is a no-op when already saving', async () => {
    let resolveFetch!: (value: unknown) => void;
    const mockFetch = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    vi.stubGlobal('fetch', mockFetch);
    const { result } = renderHook(() => useSetMyProgress('book-1'), {
      wrapper: makeWrapper({}, 'alice'),
    });
    act(() => {
      void result.current[0]({ currentChapter: 1, percentage: 0.1 });
    });
    await act(() => result.current[0]({ currentChapter: 2, percentage: 0.2 }));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    resolveFetch({ ok: true });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });
});

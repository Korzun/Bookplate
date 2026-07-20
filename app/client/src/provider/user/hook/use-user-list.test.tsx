import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { Context as AuthContext } from '../../auth/context';
import { Context } from '../context';
import type { User, UserList } from '../type';

import { useUserList } from '.';

function makeWrapper(
  initialUsers: User[] = [],
  initialLoading = false,
  initialError: string | undefined = undefined,
  isAdmin = true
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [userList, setUserListRaw] = useState<UserList>(
      Object.fromEntries(initialUsers.map((u) => [u.username, u]))
    );
    const [loading, setLoading] = useState(initialLoading);
    const [error, setError] = useState<string | undefined>(initialError);
    const setUserList = useCallback(
      (updater: (prev: UserList) => UserList) => setUserListRaw(updater),
      []
    );
    return (
      <AuthContext.Provider
        value={{
          username: isAdmin ? 'admin' : 'user',
          userId: undefined,
          isAdmin,
          mustChangePassword: false,
          loading: false,
        }}
      >
        <Context.Provider value={{ userList, loading, error, setUserList, setLoading, setError }}>
          {children}
        </Context.Provider>
      </AuthContext.Provider>
    );
  };
}

describe('useUserList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns empty list and default state initially', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    );
    const { result } = renderHook(() => useUserList(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current[1]).toBe(false));
    const [userList, loading, error, errorMessage] = result.current;
    expect(userList).toEqual([]);
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('returns users from context in sorted order', () => {
    const users: User[] = [
      { username: 'zara', progressCount: 0 },
      { username: 'alice', progressCount: 1 },
    ];
    const { result } = renderHook(() => useUserList(), { wrapper: makeWrapper(users) });
    expect(result.current[0]).toEqual([
      { username: 'alice', progressCount: 1 },
      { username: 'zara', progressCount: 0 },
    ]);
  });

  it('fetches user list on mount when admin', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', mockFetch);
    renderHook(() => useUserList(), { wrapper: makeWrapper() });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/users', {}));
  });

  it('does not fetch when user is not admin', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    renderHook(() => useUserList(), { wrapper: makeWrapper([], false, undefined, false) });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch when the user list is already populated', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    renderHook(() => useUserList(), {
      wrapper: makeWrapper([{ username: 'alice', progressCount: 0 }]),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch while loading is already true', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    renderHook(() => useUserList(), { wrapper: makeWrapper([], true) });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch when an error is already set', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    renderHook(() => useUserList(), { wrapper: makeWrapper([], false, 'Previous error') });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sets error state when the server returns a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({}) })
    );
    const { result } = renderHook(() => useUserList(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current[2]).toBe(true));
    expect(result.current[3]).toMatch(/403/);
  });
});

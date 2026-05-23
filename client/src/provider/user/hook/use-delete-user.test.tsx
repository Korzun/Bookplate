import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { User, UserList } from '../type';

import { useDeleteUser, useUserList } from '.';

function makeWrapper(initialUsers: User[] = []) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [userList, setUserListRaw] = useState<UserList>(
      Object.fromEntries(initialUsers.map((u) => [u.username, u]))
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const setUserList = useCallback(
      (updater: (prev: UserList) => UserList) => setUserListRaw(updater),
      []
    );
    return (
      <Context.Provider value={{ userList, loading, error, setUserList, setLoading, setError }}>
        {children}
      </Context.Provider>
    );
  };
}

describe('useDeleteUser', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns deleteUser function and initial false/undefined state', () => {
    const { result } = renderHook(() => useDeleteUser(), { wrapper: makeWrapper() });
    const [deleteUser, loading, error, errorMessage] = result.current;
    expect(typeof deleteUser).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('sets error and message when username is not found in list', async () => {
    const { result } = renderHook(() => useDeleteUser(), {
      wrapper: makeWrapper([{ username: 'alice', progressCount: 0 }]),
    });
    await act(() => result.current[0]('unknown'));
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Failed to delete user');
  });

  it('sends DELETE request to /api/users/:username', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }));
    const { result } = renderHook(() => useDeleteUser(), {
      wrapper: makeWrapper([{ username: 'alice', progressCount: 0 }]),
    });
    await act(() => result.current[0]('alice'));
    expect(fetch).toHaveBeenCalledWith('/api/users/alice', { method: 'DELETE' });
  });

  it('optimistically removes user from list before fetch resolves', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );
    const { result } = renderHook(() => ({ delete: useDeleteUser(), list: useUserList() }), {
      wrapper: makeWrapper([{ username: 'alice', progressCount: 0 }]),
    });
    act(() => {
      void result.current.delete[0]('alice');
    });
    expect(result.current.list[0]).toEqual([]);
    resolveFetch({ status: 204 });
    await waitFor(() => expect(result.current.delete[1]).toBe(false));
  });

  it('restores user in list and sets error when DELETE fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const { result } = renderHook(() => ({ delete: useDeleteUser(), list: useUserList() }), {
      wrapper: makeWrapper([{ username: 'alice', progressCount: 0 }]),
    });
    await act(() => result.current.delete[0]('alice'));
    expect(result.current.list[0]).toEqual([{ username: 'alice', progressCount: 0 }]);
    expect(result.current.delete[2]).toBe(true);
    expect(result.current.delete[3]).toBe('Network error');
  });

  it('sets loading to true while DELETE is pending', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );
    const { result } = renderHook(() => useDeleteUser(), {
      wrapper: makeWrapper([{ username: 'alice', progressCount: 0 }]),
    });
    act(() => {
      void result.current[0]('alice');
    });
    expect(result.current[1]).toBe(true);
    resolveFetch({ status: 204 });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });
});

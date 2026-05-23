import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context } from '../context';
import type { User, UserList } from '../type';

import { useUserList } from '.';

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

  it('fetches user list on mount', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', mockFetch);
    renderHook(() => useUserList(), { wrapper: makeWrapper() });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/users'));
  });
});

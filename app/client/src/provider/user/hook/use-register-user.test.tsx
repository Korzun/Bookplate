import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { Context } from '../context';
import type { User, UserList } from '../type';

import { useRegisterUser, useUserList } from '.';

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

describe('useRegisterUser', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns registerUser function and initial false/undefined state', () => {
    const { result } = renderHook(() => useRegisterUser(), { wrapper: makeWrapper() });
    const [registerUser, loading, error, errorMessage] = result.current;
    expect(typeof registerUser).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('sets error and message when username already exists', async () => {
    const { result } = renderHook(() => useRegisterUser(), {
      wrapper: makeWrapper([{ username: 'alice', progressCount: 0 }]),
    });
    await act(() => result.current[0]('alice'));
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Username already taken');
  });

  it('sends POST request to /api/users with only username', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ status: 201, json: () => Promise.resolve({ password: 'abc123' }) })
    );
    const { result } = renderHook(() => useRegisterUser(), { wrapper: makeWrapper() });
    await act(() => result.current[0]('alice'));
    expect(fetch).toHaveBeenCalledWith('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice' }),
    });
  });

  it('returns the generated password on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 201,
        json: () => Promise.resolve({ password: 'generatedPass123' }),
      })
    );
    const { result } = renderHook(() => useRegisterUser(), { wrapper: makeWrapper() });
    const password = await act(() => result.current[0]('alice'));
    expect(password).toBe('generatedPass123');
  });

  it('optimistically adds user in sorted order before fetch resolves', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );
    const { result } = renderHook(() => ({ register: useRegisterUser(), list: useUserList() }), {
      wrapper: makeWrapper([{ username: 'charlie', progressCount: 0 }]),
    });
    act(() => {
      void result.current.register[0]('alice');
    });
    expect(result.current.list[0][0].username).toBe('alice');
    expect(result.current.list[0][1].username).toBe('charlie');
    resolveFetch({ status: 201, json: () => Promise.resolve({ password: 'pass' }) });
    await waitFor(() => expect(result.current.register[1]).toBe(false));
  });

  it('removes optimistically added user and sets error when POST fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Server error')));
    const { result } = renderHook(() => ({ register: useRegisterUser(), list: useUserList() }), {
      wrapper: makeWrapper(),
    });
    await act(() => result.current.register[0]('alice'));
    expect(result.current.list[0]).toEqual([]);
    expect(result.current.register[2]).toBe(true);
    expect(result.current.register[3]).toBe('Server error');
  });

  it('sets loading to true while POST is pending', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );
    const { result } = renderHook(() => useRegisterUser(), { wrapper: makeWrapper() });
    act(() => {
      void result.current[0]('alice');
    });
    expect(result.current[1]).toBe(true);
    resolveFetch({ status: 201, json: () => Promise.resolve({ password: 'pass' }) });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { use, useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRegisterUser } from '.';
import { Context } from '../context';
import type { User, UserList } from '../type';

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
      wrapper: makeWrapper([{ id: 'u1', username: 'alicia', progressCount: 0 }]),
    });
    await act(() => result.current[0]('alicia'));
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
    await act(() => result.current[0]('alicia'));
    expect(fetch).toHaveBeenCalledWith('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alicia' }),
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
    const password = await act(() => result.current[0]('alicia'));
    expect(password).toBe('generatedPass123');
  });

  // These two tests read the optimistic state straight off `Context` rather
  // than through `useUserList`: as of this task, `useUserList` reads Apollo's
  // cache (see `use-user-list.ts`), not this hook's `Context`, so it can no
  // longer observe this hook's optimistic writes. The writes themselves are
  // unchanged and still worth covering directly.
  it('optimistically adds user to the list before fetch resolves', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );
    const { result } = renderHook(() => ({ register: useRegisterUser(), context: use(Context) }), {
      wrapper: makeWrapper([{ id: 'u2', username: 'charlie', progressCount: 0 }]),
    });
    act(() => {
      void result.current.register[0]('alicia');
    });
    expect(Object.keys(result.current.context.userList).sort()).toEqual(['alicia', 'charlie']);
    resolveFetch({ status: 201, json: () => Promise.resolve({ password: 'pass' }) });
    await waitFor(() => expect(result.current.register[1]).toBe(false));
  });

  it('removes optimistically added user and sets error when POST fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Server error')));
    const { result } = renderHook(() => ({ register: useRegisterUser(), context: use(Context) }), {
      wrapper: makeWrapper(),
    });
    await act(() => result.current.register[0]('alicia'));
    expect(result.current.context.userList).toEqual({});
    expect(result.current.register[2]).toBe(true);
    expect(result.current.register[3]).toBe('Server error');
  });

  it('sets error and does not POST when username is shorter than 6 characters', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => useRegisterUser(), { wrapper: makeWrapper() });
    const password = await act(() => result.current[0]('bob'));
    expect(password).toBe(null);
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Username must be at least 6 characters');
    expect(fetchSpy).not.toHaveBeenCalled();
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
      void result.current[0]('alicia');
    });
    expect(result.current[1]).toBe(true);
    resolveFetch({ status: 201, json: () => Promise.resolve({ password: 'pass' }) });
    await waitFor(() => expect(result.current[1]).toBe(false));
  });
});

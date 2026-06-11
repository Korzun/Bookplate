import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context as AuthContext } from '~/provider/auth/context';

import { useUserBookList } from './use-user-book-list';

function makeWrapper(isAdmin = false) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider
        value={{
          username: isAdmin ? 'admin' : 'user',
          setUsername: () => {},
          isAdmin,
          setIsAdmin: () => {},
          mustChangePassword: false,
          setMustChangePassword: () => {},
          refetch: () => Promise.resolve(),
          loading: false,
          error: false,
          errorMessage: undefined,
        }}
      >
        {children}
      </AuthContext.Provider>
    );
  };
}

describe('useUserBookList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not fetch while disabled', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    renderHook(() => useUserBookList('alice', false), { wrapper: makeWrapper(true) });
    await new Promise((r) => setTimeout(r, 30));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches the row user library scoped to ?user=<rowUser> when admin', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', mockFetch);

    renderHook(() => useUserBookList('alice', true), { wrapper: makeWrapper(true) });

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls[0][0]).toBe('/api/books?user=alice');
  });

  it('URL-encodes the row username', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', mockFetch);

    renderHook(() => useUserBookList('a/b user', true), { wrapper: makeWrapper(true) });

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls[0][0]).toBe('/api/books?user=a%2Fb%20user');
  });

  it('uses the bare URL for non-admin sessions', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', mockFetch);

    renderHook(() => useUserBookList('alice', true), { wrapper: makeWrapper(false) });

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls[0][0]).toBe('/api/books');
  });

  it('returns books sorted alphabetically by title', async () => {
    const books = [
      { id: '1', title: 'Zoe', author: 'A' },
      { id: '2', title: 'Apple', author: 'B' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(books) })
    );

    const { result } = renderHook(() => useUserBookList('alice', true), {
      wrapper: makeWrapper(true),
    });

    await waitFor(() => expect(result.current[0].length).toBe(2));
    expect(result.current[0].map((b) => b.title)).toEqual(['Apple', 'Zoe']);
  });

  it('surfaces an error when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useUserBookList('alice', true), {
      wrapper: makeWrapper(true),
    });

    await waitFor(() => expect(result.current[2]).toBe(true));
    expect(result.current[3]).toBe('Failed to load books');
  });
});

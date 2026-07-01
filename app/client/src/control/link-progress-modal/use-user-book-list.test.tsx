import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/api-fetch');

import { apiFetch } from '~/lib/api-fetch';
import { Context as AuthContext } from '~/provider/auth/context';

import { useUserBookList } from './use-user-book-list';

const mockApiFetch = vi.mocked(apiFetch);

const okResponse = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) }) as Response;

function makeWrapper(isAdmin = false) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider
        value={{
          username: isAdmin ? 'admin' : 'user',
          userId: isAdmin ? undefined : 'u1',
          isAdmin,
          mustChangePassword: false,
          loading: false,
        }}
      >
        {children}
      </AuthContext.Provider>
    );
  };
}

describe('useUserBookList', () => {
  afterEach(() => mockApiFetch.mockReset());

  it('does not fetch while disabled', async () => {
    renderHook(() => useUserBookList('alice', false), { wrapper: makeWrapper(true) });
    await new Promise((r) => setTimeout(r, 30));
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('fetches via apiFetch (sends the auth token) scoped to ?user=<rowUser> when admin', async () => {
    mockApiFetch.mockResolvedValue(okResponse([]));

    renderHook(() => useUserBookList('alice', true), { wrapper: makeWrapper(true) });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(mockApiFetch.mock.calls[0][0]).toBe('/api/books?user=alice');
  });

  it('URL-encodes the row username', async () => {
    mockApiFetch.mockResolvedValue(okResponse([]));

    renderHook(() => useUserBookList('a/b user', true), { wrapper: makeWrapper(true) });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(mockApiFetch.mock.calls[0][0]).toBe('/api/books?user=a%2Fb%20user');
  });

  it('uses the bare URL for non-admin sessions', async () => {
    mockApiFetch.mockResolvedValue(okResponse([]));

    renderHook(() => useUserBookList('alice', true), { wrapper: makeWrapper(false) });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(mockApiFetch.mock.calls[0][0]).toBe('/api/books');
  });

  it('returns books sorted alphabetically by title', async () => {
    const books = [
      { id: '1', title: 'Zoe', author: 'A' },
      { id: '2', title: 'Apple', author: 'B' },
    ];
    mockApiFetch.mockResolvedValue(okResponse(books));

    const { result } = renderHook(() => useUserBookList('alice', true), {
      wrapper: makeWrapper(true),
    });

    await waitFor(() => expect(result.current[0].length).toBe(2));
    expect(result.current[0].map((b) => b.title)).toEqual(['Apple', 'Zoe']);
  });

  it('surfaces an error when the fetch fails', async () => {
    mockApiFetch.mockResolvedValue({ ok: false } as Response);

    const { result } = renderHook(() => useUserBookList('alice', true), {
      wrapper: makeWrapper(true),
    });

    await waitFor(() => expect(result.current[2]).toBe(true));
    expect(result.current[3]).toBe('Failed to load books');
  });
});

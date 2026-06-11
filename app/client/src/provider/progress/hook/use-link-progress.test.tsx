import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Context as AuthContext } from '~/provider/auth/context';

import { Context } from '../context';
import type { ProgressList, UserProgressList } from '../type';

import { useLinkProgress } from './use-link-progress';

function makeWrapper(initialProgress: ProgressList = {}, isAdmin = false) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const [progressList, setProgressListRaw] = useState<ProgressList>(initialProgress);
    const setProgressForUsername = useCallback((username: string, data: UserProgressList) => {
      setProgressListRaw((prev) => ({ ...prev, [username]: data }));
    }, []);
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
      </AuthContext.Provider>
    );
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useLinkProgress', () => {
  it('returns initial state', () => {
    const { result } = renderHook(() => useLinkProgress('book-1', 'alice'), {
      wrapper: makeWrapper(),
    });
    const [link, linking, error, errorMessage] = result.current;
    expect(typeof link).toBe('function');
    expect(linking).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('on success: completes without error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true }));

    const initial: ProgressList = {
      alice: {
        'orphan-doc': { document: 'orphan-doc', percentage: 0.5 },
        'book-1': { document: 'book-1', percentage: 0.8 },
      },
    };

    const { result } = renderHook(() => useLinkProgress('book-1', 'alice'), {
      wrapper: makeWrapper(initial),
    });

    await act(() => result.current[0]('orphan-doc'));
    await waitFor(() => expect(result.current[1]).toBe(false));

    expect(result.current[2]).toBe(false);
  });

  it('on error: sets error state and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 409,
        ok: false,
        json: () => Promise.resolve({ error: 'Already linked' }),
      })
    );

    const { result } = renderHook(() => useLinkProgress('book-1', 'alice'), {
      wrapper: makeWrapper(),
    });

    await act(() => result.current[0]('orphan-doc'));
    await waitFor(() => expect(result.current[2]).toBe(true));

    expect(result.current[3]).toBe('Already linked');
  });

  it('calls POST /api/books/:bookId/link with the correct body (non-admin: bare URL)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 204, ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useLinkProgress('target-book', 'alice'), {
      wrapper: makeWrapper(),
    });

    await act(() => result.current[0]('orphan-id'));

    expect(mockFetch).toHaveBeenCalledWith('/api/books/target-book/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: 'orphan-id' }),
    });
  });

  it('scopes the link POST to the row user (not the switcher) when admin', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 204, ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useLinkProgress('target-book', 'alice'), {
      wrapper: makeWrapper({}, true),
    });

    await act(() => result.current[0]('orphan-id'));

    expect(mockFetch).toHaveBeenCalledWith('/api/books/target-book/link?user=alice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: 'orphan-id' }),
    });
  });

  it('URL-encodes the row username when admin', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 204, ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useLinkProgress('target-book', 'a/b user'), {
      wrapper: makeWrapper({}, true),
    });

    await act(() => result.current[0]('orphan-id'));

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/books/target-book/link?user=a%2Fb%20user',
      expect.anything()
    );
  });
});

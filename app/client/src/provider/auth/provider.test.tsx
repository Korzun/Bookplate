import { act, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeJwt } from '../../lib/test-jwt';
import { setToken } from '../../lib/token';
import { Context } from './context';
import { AuthProvider } from './provider';

const Probe = () => {
  const { username, userId, isAdmin, mustChangePassword, loading } = useContext(Context);
  return (
    <div>
      <span data-testid="username">{username ?? 'none'}</span>
      <span data-testid="user-id">{userId ?? 'none'}</span>
      <span data-testid="is-admin">{String(isAdmin)}</span>
      <span data-testid="must-change">{String(mustChangePassword)}</span>
      <span data-testid="loading">{String(loading)}</span>
    </div>
  );
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

const futureExp = () => Math.floor(Date.now() / 1000) + 900;

describe('AuthProvider', () => {
  it('derives auth state from a valid stored token without fetching', async () => {
    localStorage.setItem(
      'accessToken',
      makeJwt({
        sub: 'u1',
        username: 'alice',
        isAdmin: false,
        mustChangePassword: true,
        exp: futureExp(),
      })
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('username')).toHaveTextContent('alice');
    expect(screen.getByTestId('user-id')).toHaveTextContent('u1');
    expect(screen.getByTestId('must-change')).toHaveTextContent('true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('attempts a silent refresh when no token is stored', async () => {
    const token = makeJwt({
      sub: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
      exp: futureExp(),
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ accessToken: token }), { status: 200 })
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', { method: 'POST' });
  });

  it('renders logged-out when the silent refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('username')).toHaveTextContent('none');
    expect(screen.getByTestId('is-admin')).toHaveTextContent('false');
  });

  it('schedules a proactive refresh one minute before expiry', async () => {
    vi.useFakeTimers();
    const exp = Math.floor(Date.now() / 1000) + 300; // 5 min out
    localStorage.setItem(
      'accessToken',
      makeJwt({ sub: 'u1', username: 'alice', isAdmin: false, mustChangePassword: false, exp })
    );
    const next = makeJwt({
      sub: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
      exp: exp + 900,
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accessToken: next }), { status: 200 })
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 1000); // past exp - 60s
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', { method: 'POST' });
  });

  it('picks up a token stored after render (login flow)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 })); // mount refresh fails
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('username')).toHaveTextContent('none');

    act(() => {
      setToken(
        makeJwt({
          sub: 'u1',
          username: 'alice',
          isAdmin: false,
          mustChangePassword: false,
          exp: futureExp(),
        })
      );
    });
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'));
  });

  it('masks a late wake-up past expiry as loading instead of logged-out', async () => {
    vi.useFakeTimers();
    const exp = Math.floor(Date.now() / 1000) + 300;
    localStorage.setItem(
      'accessToken',
      makeJwt({ sub: 'u1', username: 'alice', isAdmin: false, mustChangePassword: false, exp })
    );
    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (release = resolve)));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    // Simulate tab sleep: clock jumps past exp before the timer can fire.
    act(() => {
      vi.setSystemTime(Date.now() + 400 * 1000);
    });
    // Drain the proactive timer (armed at exp-60s ≈ 240s out). With the system
    // clock already past exp, isExpired(claims) is true at fire time.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300 * 1000);
    });
    expect(screen.getByTestId('loading')).toHaveTextContent('true'); // masked, no bounce
    const next = makeJwt({
      sub: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    await act(async () => {
      release(new Response(JSON.stringify({ accessToken: next }), { status: 200 }));
    });
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('username')).toHaveTextContent('alice');
  });

  it('treats a malformed stored token as logged-out (after refresh fails)', async () => {
    localStorage.setItem('accessToken', 'garbage');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('username')).toHaveTextContent('none');
  });
});

describe('AuthProvider — cross-tab storage sync', () => {
  const aliceToken = () =>
    makeJwt({
      sub: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
      exp: futureExp(),
    });

  // Simulate a write from ANOTHER tab: mutate the shared store directly and
  // deliver the native storage event the browser fires in other tabs. We do
  // NOT use setToken/clearToken here — those dispatch the in-tab
  // TOKEN_CHANGED_EVENT, which would hide whether the storage listener works.
  const dispatchStorage = (key: string | null, newValue: string | null) =>
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));

  it('adopts a token a sibling tab stored (cross-tab refresh) without re-refreshing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 })); // this tab mounts logged-out
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('username')).toHaveTextContent('none');

    const sibling = aliceToken();
    act(() => {
      localStorage.setItem('accessToken', sibling);
      dispatchStorage('accessToken', sibling);
    });

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'));
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the mount refresh; adopted, not re-fetched
  });

  it('logs out when a sibling tab clears the token', async () => {
    // Losing the token re-arms the silent bootstrap refresh (the cookie may
    // still be good); here it is gone too, so the refresh cleanly fails.
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    localStorage.setItem('accessToken', aliceToken());
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'));

    act(() => {
      localStorage.removeItem('accessToken');
      dispatchStorage('accessToken', null);
    });

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('none'));
  });

  it('logs out on a cross-tab localStorage.clear() (storage event with key null)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    localStorage.setItem('accessToken', aliceToken());
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'));

    act(() => {
      localStorage.clear();
      dispatchStorage(null, null);
    });

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('none'));
  });
});

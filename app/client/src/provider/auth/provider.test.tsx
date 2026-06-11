import { act, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeJwt } from '../../lib/test-jwt';

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

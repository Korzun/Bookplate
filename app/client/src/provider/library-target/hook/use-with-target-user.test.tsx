import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { makeJwt } from '~/lib/test-jwt';
import { setToken } from '~/lib/token';
import { AuthProvider } from '~/provider/auth';
import { LibraryTargetProvider } from '~/provider/library-target';

import { useLibraryTarget } from './use-library-target';
import { useWithTargetUser } from './use-with-target-user';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>
    <LibraryTargetProvider>{children}</LibraryTargetProvider>
  </AuthProvider>
);

// Auth state derives from the stored JWT; seed one instead of mocking fetch.
const seedAuth = (isAdmin: boolean) => {
  setToken(
    makeJwt({
      ...(isAdmin ? {} : { sub: 'u1' }),
      username: isAdmin ? 'admin' : 'x',
      isAdmin,
      mustChangePassword: false,
      exp: Math.floor(Date.now() / 1000) + 900,
    })
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('returns URLs unchanged for non-admin users', async () => {
  seedAuth(false);
  const { result } = renderHook(
    () => ({ withTarget: useWithTargetUser(), target: useLibraryTarget() }),
    { wrapper }
  );
  await act(async () => {
    result.current.target[1]('alice');
  });
  expect(result.current.withTarget('/api/books')).toBe('/api/books');
});

it('appends ?user= for admins with a target selected', async () => {
  seedAuth(true);
  const { result } = renderHook(
    () => ({ withTarget: useWithTargetUser(), target: useLibraryTarget() }),
    { wrapper }
  );
  await act(async () => {
    result.current.target[1]('alice');
  });
  expect(result.current.withTarget('/api/books')).toBe('/api/books?user=alice');
  expect(result.current.withTarget('/api/books/x/cover?width=60')).toBe(
    '/api/books/x/cover?width=60&user=alice'
  );
});

it('persists the target in localStorage', async () => {
  seedAuth(true);
  const { result } = renderHook(() => useLibraryTarget(), { wrapper });
  await act(async () => {
    result.current[1]('bob');
  });
  expect(localStorage.getItem('library-target-user')).toBe('bob');
});

it('reads an existing localStorage value on mount', async () => {
  localStorage.setItem('library-target-user', 'alice');
  seedAuth(true);
  const { result } = renderHook(() => useLibraryTarget(), { wrapper });
  await act(async () => {});
  expect(result.current[0]).toBe('alice');
});

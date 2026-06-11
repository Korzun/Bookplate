import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { AuthProvider } from '~/provider/auth';
import { LibraryTargetProvider } from '~/provider/library-target';

import { useLibraryTarget } from './use-library-target';
import { useWithTargetUser } from './use-with-target-user';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>
    <LibraryTargetProvider>{children}</LibraryTargetProvider>
  </AuthProvider>
);

const mockMe = (isAdmin: boolean) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ username: 'x', isAdmin, mustChangePassword: false }),
    })
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('returns URLs unchanged for non-admin users', async () => {
  mockMe(false);
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
  mockMe(true);
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
  mockMe(true);
  const { result } = renderHook(() => useLibraryTarget(), { wrapper });
  await act(async () => {
    result.current[1]('bob');
  });
  expect(localStorage.getItem('library-target-user')).toBe('bob');
});

it('reads an existing localStorage value on mount', async () => {
  localStorage.setItem('library-target-user', 'alice');
  mockMe(true);
  const { result } = renderHook(() => useLibraryTarget(), { wrapper });
  await act(async () => {});
  expect(result.current[0]).toBe('alice');
});

import { useQuery } from '@apollo/client/react';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { UserListDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { LibraryTargetProvider } from '../provider';
import { useWithTargetUser } from './use-with-target-user';

const STORAGE_KEY = 'library-target-id';

const user = (overrides: Record<string, unknown>) => ({
  __typename: 'User' as const,
  id: 'u1',
  username: 'alice',
  progressCount: 0,
  library: { __typename: 'Library' as const, id: 'LIB-ALICE' },
  ...overrides,
});

const userListMock = (users: ReturnType<typeof user>[]) => ({
  request: { query: UserListDocument },
  result: {
    data: {
      __typename: 'Query' as const,
      viewer: { __typename: 'Viewer' as const, users },
    },
  },
});

/**
 * Renders `useWithTargetUser` inside a real `LibraryTargetProvider`
 * (`useLibraryTarget` reads `localStorage` through it) plus `renderWithApollo`
 * for `UserListDocument`. `isAdmin` drives `renderWithApollo`'s own
 * `AuthContext` value, same as `use-user-list.test.tsx`'s `renderUserList` —
 * no JWT/`AuthProvider` needed since `useIsAdmin` only reads that context.
 *
 * Also renders a second, identically-keyed `useQuery(UserListDocument)` as a
 * test-only readiness signal (the same pattern `use-scan-library.test.tsx`
 * uses): query deduplication means it observes the SAME response as the one
 * inside the hook, without consuming a second mock.
 */
const renderWithTargetUser = (isAdmin: boolean, mocks: ReturnType<typeof userListMock>[] = []) => {
  const result: { current?: { call: ReturnType<typeof useWithTargetUser>; loaded: boolean } } = {};
  const Probe = () => {
    const call = useWithTargetUser();
    const { loading } = useQuery(UserListDocument, { skip: !isAdmin });
    result.current = { call, loaded: !loading };
    return null;
  };
  renderWithApollo(
    <LibraryTargetProvider>
      <Probe />
    </LibraryTargetProvider>,
    { mocks, user: { username: isAdmin ? 'admin' : 'alice', isAdmin } }
  );
  return result;
};

describe('useWithTargetUser', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns URLs unchanged for non-admin users', () => {
    const result = renderWithTargetUser(false);
    expect(result.current?.loaded).toBe(true);
    expect(result.current?.call('/api/books')).toBe('/api/books');
  });

  it('returns URLs unchanged for an admin with no library selected', async () => {
    const result = renderWithTargetUser(true, [userListMock([user({})])]);

    await waitFor(() => expect(result.current?.loaded).toBe(true));
    expect(result.current?.call('/api/books')).toBe('/api/books');
  });

  it('appends ?user=<username> for an admin, resolved by matching the selected library id', async () => {
    localStorage.setItem(STORAGE_KEY, 'LIB-ALICE');
    const result = renderWithTargetUser(true, [
      userListMock([
        user({ id: 'u1', username: 'alice', library: { __typename: 'Library', id: 'LIB-ALICE' } }),
        user({ id: 'u2', username: 'bob', library: { __typename: 'Library', id: 'LIB-BOB' } }),
      ]),
    ]);

    await waitFor(() => expect(result.current?.loaded).toBe(true));
    expect(result.current?.call('/api/books')).toBe('/api/books?user=alice');
    expect(result.current?.call('/api/books/x/cover?width=60')).toBe(
      '/api/books/x/cover?width=60&user=alice'
    );
  });

  it('returns URLs unchanged when the stored selection matches no user in the list', async () => {
    localStorage.setItem(STORAGE_KEY, 'LIB-GHOST');
    const result = renderWithTargetUser(true, [
      userListMock([
        user({ id: 'u1', username: 'alice', library: { __typename: 'Library', id: 'LIB-ALICE' } }),
      ]),
    ]);

    await waitFor(() => expect(result.current?.loaded).toBe(true));
    expect(result.current?.call('/api/books')).toBe('/api/books');
  });
});

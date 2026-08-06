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
 * Reads readiness straight off the returned function's own `.ready` property
 * (C-1's fix) rather than a separate duplicate `useQuery` probe — a second,
 * independently-`skip`ped query would silently diverge from whatever `skip`
 * logic is actually under test inside the hook (exactly the gap that let an
 * earlier version of this file's seen-to-fail miss a real regression).
 */
const renderWithTargetUser = (isAdmin: boolean, mocks: ReturnType<typeof userListMock>[] = []) => {
  const result: { current?: ReturnType<typeof useWithTargetUser> } = {};
  const Probe = () => {
    result.current = useWithTargetUser();
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

  // A stored selection that matches a REAL user in the list — unlike a bare
  // "nothing to leak" render, this actually exercises the `isAdmin` guard:
  // deleting `!isAdmin` from both the query's `skip` and the callback below
  // leaks `?user=alice` here (verified by seen-to-fail; see task-4
  // fix-round-1 report).
  it('returns URLs unchanged for non-admin users, even when the stored selection matches a real library', async () => {
    localStorage.setItem(STORAGE_KEY, 'LIB-ALICE');
    const result = renderWithTargetUser(false, [
      userListMock([
        user({ id: 'u1', username: 'alice', library: { __typename: 'Library', id: 'LIB-ALICE' } }),
      ]),
    ]);
    expect(result.current?.ready).toBe(true);
    expect(result.current?.('/api/books')).toBe('/api/books');

    // Give the (correctly skipped) query every chance to fire and resolve —
    // proves the guard holds, not just a synchronous timing accident. With
    // `skip: !isAdmin` intact this mock is never consumed and nothing
    // changes; with the guard deleted it resolves here and leaks `?user=`.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current?.('/api/books')).toBe('/api/books');
  });

  it('returns URLs unchanged for an admin with no library selected', async () => {
    const result = renderWithTargetUser(true, [userListMock([user({})])]);

    await waitFor(() => expect(result.current?.ready).toBe(true));
    expect(result.current?.('/api/books')).toBe('/api/books');
  });

  it('is not ready until UserListDocument resolves, for an admin with a stored selection', () => {
    localStorage.setItem(STORAGE_KEY, 'LIB-ALICE');
    const result = renderWithTargetUser(true, [
      userListMock([
        user({ id: 'u1', username: 'alice', library: { __typename: 'Library', id: 'LIB-ALICE' } }),
      ]),
    ]);

    // Synchronous assertion, deliberately not behind `waitFor`: on the very
    // first render (the cold-load case C-1 is about), the query cannot have
    // resolved yet — `ready` must reflect that, not default to `true`.
    expect(result.current?.ready).toBe(false);
    expect(result.current?.('/api/books')).toBe('/api/books');
  });

  it('appends ?user=<username> for an admin, resolved by matching the selected library id', async () => {
    localStorage.setItem(STORAGE_KEY, 'LIB-ALICE');
    const result = renderWithTargetUser(true, [
      userListMock([
        user({ id: 'u1', username: 'alice', library: { __typename: 'Library', id: 'LIB-ALICE' } }),
        user({ id: 'u2', username: 'bob', library: { __typename: 'Library', id: 'LIB-BOB' } }),
      ]),
    ]);

    await waitFor(() => expect(result.current?.ready).toBe(true));
    expect(result.current?.('/api/books')).toBe('/api/books?user=alice');
    expect(result.current?.('/api/books/x/cover?width=60')).toBe(
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

    await waitFor(() => expect(result.current?.ready).toBe(true));
    expect(result.current?.('/api/books')).toBe('/api/books');
  });
});

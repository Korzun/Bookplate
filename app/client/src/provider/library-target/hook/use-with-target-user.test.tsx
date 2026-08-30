import type { MockedResponse } from '@apollo/client/testing';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { UserRowFragment } from '~/component/user-row';
import { makeFragmentData } from '~/gql';
import type { UserListQuery } from '~/gql/graphql';
import { UserListDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { LibraryTargetProvider } from '../provider';
import { useWithTargetUser } from './use-with-target-user';

const STORAGE_KEY = 'library-target-id';

/**
 * `UserListDocument` spreads `...UserRowFragment` — a raw field literal
 * fails TypeScript's excess-property check against the resulting masked
 * type, so `makeFragmentData` is the sanctioned cast back to it (see
 * `page/device-list/index.test.tsx`'s identical note).
 */
const user = (overrides: { id?: string; username?: string; libraryId?: string }) => ({
  __typename: 'User' as const,
  ...makeFragmentData(
    {
      __typename: 'User' as const,
      id: overrides.id ?? 'u1',
      username: overrides.username ?? 'alice',
      progressCount: 0,
      pendingBookRequestCount: 0,
    },
    UserRowFragment
  ),
  library: { __typename: 'Library' as const, id: overrides.libraryId ?? 'LIB-ALICE' },
});

/**
 * `request.variables` is MockLink's VARIABLE-MATCHER form (a function, not an
 * object): `MockLink.request()` calls it SYNCHRONOUSLY from its own
 * `mocks.findIndex(...)`
 * (`@apollo/client/testing/core/mocking/mockLink.js`), in the same tick the
 * operation is issued. `UserListDocument` takes no variables, so the matcher
 * always returns `true` — the COUNT is the point: it is what pins
 * `skip: !isAdmin` on this hook's own query (see the non-admin case below).
 * Counting on DELIVERY instead (a `result` function) would race MockLink's
 * random 20-50ms `realisticDelay`; counting at request time fails CLOSED.
 * Note this is the `variables` FIELD inside `request` — a top-level
 * `variableMatcher` key is silently ignored by current MockLink.
 */
const userListRequests = { count: 0 };

const userListMock = (users: ReturnType<typeof user>[]): MockedResponse<UserListQuery> => ({
  request: {
    query: UserListDocument,
    variables: function userListVariables() {
      userListRequests.count += 1;
      return true;
    },
  },
  maxUsageCount: Infinity,
  result: {
    data: {
      __typename: 'Query',
      viewer: { __typename: 'Viewer', users },
    },
  },
});

/**
 * Renders `useWithTargetUser` inside a real `LibraryTargetProvider`
 * (`useLibraryTarget` reads `localStorage` through it) plus `renderWithApollo`
 * for `UserListDocument`. `isAdmin` drives `renderWithApollo`'s own
 * `AuthContext` value — no JWT/`AuthProvider` needed since `useIsAdmin` only
 * reads that context. (This cited `use-user-list.test.tsx`'s `renderUserList`
 * as the matching example; Task 2 deleted that file along with
 * `provider/user`. `page/user-list/index.test.tsx` is the live equivalent.)
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
  beforeEach(() => {
    userListRequests.count = 0;
  });

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
      userListMock([user({ id: 'u1', username: 'alice', libraryId: 'LIB-ALICE' })]),
    ]);
    // `ready` is `true` immediately here (`skip: !isAdmin` never lets the
    // query fire for a non-admin), so this resolves on the first poll — but
    // `waitFor` (not a fixed timer) is what makes this a REAL check rather
    // than a synchronous-timing accident: with the guard deleted, `skip`
    // stops blocking the query, `waitFor` keeps polling through the actual
    // resolve-and-re-render cycle, `ready` still eventually flips `true`,
    // and the assertion below then sees the leak. A bare `await new
    // Promise(...)` here previously looked like it exercised this but
    // didn't — the resolved query never flushed into `result.current`
    // without something `act`-aware (`waitFor`) driving it (round-2 review).
    await waitFor(() => expect(result.current?.ready).toBe(true));
    expect(result.current?.('/api/books')).toBe('/api/books');
    // The URL assertion above pins the CALLBACK's own `!isAdmin` guard; this
    // one pins the QUERY's `skip: !isAdmin` independently. They are separate
    // regressions — deleting only the `skip` still leaks a `FORBIDDEN`
    // request per non-admin, with every URL still coming back unchanged
    // because the callback guard catches it. Counted at REQUEST time (see
    // `userListRequests` above), so it fails closed with no tuned wait.
    // Seen-to-fail: `skip: !isAdmin` -> `skip: false` in
    // `use-with-target-user.ts` makes this 1.
    expect(userListRequests.count).toBe(0);
  });

  it('returns URLs unchanged for an admin with no library selected', async () => {
    const result = renderWithTargetUser(true, [userListMock([user({})])]);

    await waitFor(() => expect(result.current?.ready).toBe(true));
    expect(result.current?.('/api/books')).toBe('/api/books');
  });

  it('is not ready until UserListDocument resolves, for an admin with a stored selection', () => {
    localStorage.setItem(STORAGE_KEY, 'LIB-ALICE');
    const result = renderWithTargetUser(true, [
      userListMock([user({ id: 'u1', username: 'alice', libraryId: 'LIB-ALICE' })]),
    ]);

    // Synchronous assertion, deliberately not behind `waitFor`: on the very
    // first render (the cold-load case C-1 is about), the query cannot have
    // resolved yet — `ready` must reflect that, not default to `true`.
    expect(result.current?.ready).toBe(false);
    expect(result.current?.('/api/books')).toBe('/api/books');
  });

  // Round-2 review (minor): every OTHER test in this file has `targetUsername`
  // itself change on the same tick as `ready` — which would make even a
  // mutate-in-place `Object.assign(useCallback(...), { ready })` pass, since
  // `targetUsername` changing already forces `useCallback` to recompute
  // regardless of how `ready` is attached. This test isolates the one shape
  // that wouldn't: a stored selection matching NO user, where `ready` flips
  // false→true while `targetUsername` stays `undefined` throughout. A
  // mutate-in-place implementation returns the SAME object both times here
  // (nothing it depends on changed), which is exactly the hazard the fresh
  // `useMemo` object exists to avoid — see this hook's own doc comment.
  it('returns a new function reference when ready flips, even though targetUsername stays undefined (no match)', async () => {
    localStorage.setItem(STORAGE_KEY, 'LIB-GHOST');
    const result = renderWithTargetUser(true, [
      userListMock([user({ id: 'u1', username: 'alice', libraryId: 'LIB-ALICE' })]),
    ]);

    const before = result.current;
    expect(before?.ready).toBe(false);

    await waitFor(() => expect(result.current?.ready).toBe(true));
    const after = result.current;

    expect(after).not.toBe(before);
    expect(after?.('/api/books')).toBe('/api/books');
  });

  it('appends ?user=<username> for an admin, resolved by matching the selected library id', async () => {
    localStorage.setItem(STORAGE_KEY, 'LIB-ALICE');
    const result = renderWithTargetUser(true, [
      userListMock([
        user({ id: 'u1', username: 'alice', libraryId: 'LIB-ALICE' }),
        user({ id: 'u2', username: 'bob', libraryId: 'LIB-BOB' }),
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
      userListMock([user({ id: 'u1', username: 'alice', libraryId: 'LIB-ALICE' })]),
    ]);

    await waitFor(() => expect(result.current?.ready).toBe(true));
    expect(result.current?.('/api/books')).toBe('/api/books');
  });
});

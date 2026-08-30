import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRowFragment } from '~/component/user-row';
import { makeFragmentData } from '~/gql';
import type { UserListQuery } from '~/gql/graphql';
import { UserListDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { UserListPage } from './index';

// UserRow renders a ConfirmModal (for delete), which calls the native
// <dialog> showModal/close methods jsdom does not implement.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

// The user row is spread through `...UserRowFragment` in `UserListDocument`,
// so `UserListQuery`'s `users` entries are the MASKED type — a raw field
// literal fails TypeScript's excess-property check against it (see
// `page/device-list/index.test.tsx`'s identical note on why
// `makeFragmentData` is the sanctioned cast back to that masked type).
const aliceRow = {
  __typename: 'User' as const,
  ...makeFragmentData(
    {
      __typename: 'User' as const,
      id: 'USER-1',
      username: 'alice',
      progressCount: 4,
      pendingBookRequestCount: 0,
    },
    UserRowFragment
  ),
  library: { __typename: 'Library' as const, id: 'LIB-1' },
};

/**
 * Counts every `UserList` request `MockLink` is asked to match, at REQUEST
 * time. `request.variables` as a FUNCTION is MockLink's variable-matcher
 * form: it is called SYNCHRONOUSLY from `MockLink.request()`'s
 * `mocks.findIndex(...)` (`@apollo/client/testing/core/mocking/mockLink.js`),
 * in the same tick the operation is issued and before any delivery delay.
 * That is what lets the "issues no request" case below fail CLOSED — see
 * `page/book/index.test.tsx`'s longer note on why a `result` function (which
 * runs on DELIVERY, after a random 20-50ms `realisticDelay`) cannot do this
 * job. Note this is the `variables` FIELD inside `request`; a TOP-LEVEL
 * `variableMatcher` key is a different (older) API that current MockLink
 * ignores silently, yielding a fail-open test.
 *
 * `maxUsageCount: Infinity` so a regression that fires the query twice is
 * counted twice rather than masked by a "No more mocked responses" error.
 */
const userListRequests = { count: 0 };

beforeEach(() => {
  userListRequests.count = 0;
});

const userListMock = (): MockedResponse<UserListQuery> => ({
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
      viewer: { __typename: 'Viewer', users: [aliceRow] },
    },
  },
});

describe('UserListPage', () => {
  it('renders a user row from the composed query', async () => {
    renderWithApollo(<UserListPage />, {
      mocks: [userListMock()],
      user: { username: 'admin', isAdmin: true },
    });

    await waitFor(() => expect(screen.getAllByText('alice').length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText('4 books synced')).toBeInTheDocument();
  });

  // `skip: !isAdmin` must stop the `UserList` query before the server ever
  // gets to deny it: `Viewer.users` is admin-gated, so an unguarded read
  // answers `users: null` + `FORBIDDEN`, and `errorPolicy: 'none'` then
  // discards the whole result.
  //
  // The pin is the REQUEST COUNTER, not `mocks: []`. `MockLink` does NOT
  // throw on an unmatched request — verified against
  // `@apollo/client/testing/core/mocking/mockLink.js`, which `console.warn`s
  // and returns an observable that errors ASYNCHRONOUSLY
  // (`observeOn(asapScheduler)`); a synchronous test never observes that,
  // and nothing in `setup.ts` promotes the warning to a failure. The
  // `getByText('Register a user')` assertion is fail-open for a second,
  // independent reason: `UserListPage` renders `<UserRegister />`
  // UNCONDITIONALLY, so that text is present whether or not the query fired.
  //
  // Seen-to-fail: deleting `skip: !isAdmin` from `./index.tsx` makes
  // `userListRequests.count` 1 and this test red.
  it('issues no request for a non-admin viewer', () => {
    renderWithApollo(<UserListPage />, {
      mocks: [userListMock()],
      user: { username: 'a', isAdmin: false },
    });

    expect(userListRequests.count).toBe(0);
    expect(screen.getByText('Register a user')).toBeInTheDocument();
  });
});

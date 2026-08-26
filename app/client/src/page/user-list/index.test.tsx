import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { UserRowFragment } from '~/component/user-row';
import { makeFragmentData } from '~/gql';
import type { UserListQuery } from '~/gql/graphql';
import { renderWithApollo } from '~/test-utils';

import { UserListDocument, UserListPage } from './index';

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
    },
    UserRowFragment
  ),
  library: { __typename: 'Library' as const, id: 'LIB-1' },
};

const userListMock = (): MockedResponse<UserListQuery> => ({
  request: { query: UserListDocument },
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
  // gets to deny it — `mocks: []` proves that: `MockLink` throws on an
  // unmatched request, so this only passes if no request is ever sent.
  it('issues no request for a non-admin viewer', () => {
    renderWithApollo(<UserListPage />, {
      mocks: [],
      user: { username: 'a', isAdmin: false },
    });

    expect(screen.getByText('Register a user')).toBeInTheDocument();
  });
});

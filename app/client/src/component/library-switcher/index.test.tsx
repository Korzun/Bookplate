import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { UserRowFragment } from '~/component/user-row';
import { makeFragmentData } from '~/gql';
import type { UserListQuery } from '~/gql/graphql';
import { UserListDocument } from '~/page/user-list';
import { LibraryTargetProvider } from '~/provider/library-target';
import { renderWithApollo } from '~/test-utils';

import { LibrarySwitcher } from '.';

const user = (overrides: { id?: string; username?: string; libraryId?: string }) => ({
  __typename: 'User' as const,
  ...makeFragmentData(
    {
      __typename: 'User' as const,
      id: overrides.id ?? 'u1',
      username: overrides.username ?? 'alice',
      progressCount: 0,
    },
    UserRowFragment
  ),
  library: { __typename: 'Library' as const, id: overrides.libraryId ?? 'lib-alice' },
});

const userListMock = (users: ReturnType<typeof user>[]): MockedResponse<UserListQuery> => ({
  request: { query: UserListDocument },
  result: {
    data: { __typename: 'Query', viewer: { __typename: 'Viewer', users } },
  },
});

const userListErrorMock = (): MockedResponse<UserListQuery> => ({
  request: { query: UserListDocument },
  error: new Error('user list query failed'),
});

afterEach(() => {
  localStorage.clear();
});

// `useLibraryTarget` (inside `AdminLibrarySwitcher`) reads/writes through
// `LibraryTargetProvider`'s context, backed by `localStorage` — a bare
// `renderWithApollo` has no such provider in its stack (see
// `use-with-target-user.test.tsx`'s identical wrapping), so every render
// here supplies its own.
function renderAsUser() {
  return renderWithApollo(
    <LibraryTargetProvider>
      <LibrarySwitcher />
    </LibraryTargetProvider>,
    { mocks: [], user: { username: 'alice', isAdmin: false } }
  );
}

function renderAsAdmin(mocks: MockedResponse[] = []) {
  return renderWithApollo(
    <LibraryTargetProvider>
      <LibrarySwitcher />
    </LibraryTargetProvider>,
    { mocks, user: { username: 'admin', isAdmin: true } }
  );
}

describe('LibrarySwitcher', () => {
  it('renders nothing for non-admin users, and issues no request', () => {
    renderAsUser();
    expect(screen.queryByRole('button', { name: 'Select library…' })).not.toBeInTheDocument();
  });

  it("stores the selected user's library id, not their username", async () => {
    renderAsAdmin([
      userListMock([
        user({ id: 'u1', username: 'alice', libraryId: 'lib-alice' }),
        user({ id: 'u2', username: 'bob', libraryId: 'lib-bob' }),
      ]),
    ]);
    // The trigger's accessible name is "Select library…" via a STATIC
    // `aria-label` even while its visible text still reads "Loading…" —
    // `Select.open()` itself is a no-op while `loading` is true, so this
    // must wait for the real loading text to clear before clicking, not
    // just for the (always-present) named button to exist.
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Select library…' }));
    await userEvent.click(await screen.findByRole('option', { name: 'alice' }));
    expect(localStorage.getItem('library-target-id')).toBe('lib-alice');
  });

  it('clears a persisted target whose library id is missing from the loaded user list', async () => {
    localStorage.setItem('library-target-id', 'lib-ghost');
    renderAsAdmin([userListMock([user({ id: 'u1', username: 'alice', libraryId: 'lib-alice' })])]);

    await waitFor(() => {
      expect(localStorage.getItem('library-target-id')).toBeNull();
      expect(screen.getByRole('button', { name: 'Select library…' })).toBeInTheDocument();
    });
  });

  it('keeps a persisted target present in the loaded user list', async () => {
    localStorage.setItem('library-target-id', 'lib-bob');
    renderAsAdmin([
      userListMock([
        user({ id: 'u1', username: 'alice', libraryId: 'lib-alice' }),
        user({ id: 'u2', username: 'bob', libraryId: 'lib-bob' }),
      ]),
    ]);
    expect(await screen.findByRole('button', { name: 'bob' })).toBeInTheDocument();
    expect(localStorage.getItem('library-target-id')).toBe('lib-bob');
  });

  it('keeps the persisted target while the user list is loading', () => {
    localStorage.setItem('library-target-id', 'lib-ghost');
    renderAsAdmin([{ ...userListMock([user({})]), delay: 60000 }]);
    expect(localStorage.getItem('library-target-id')).toBe('lib-ghost');
  });

  it('keeps the persisted target when the user list errors', async () => {
    localStorage.setItem('library-target-id', 'lib-ghost');
    renderAsAdmin([userListErrorMock()]);
    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());
    expect(localStorage.getItem('library-target-id')).toBe('lib-ghost');
  });
});

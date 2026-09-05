import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { UserRowFragment } from '~/component/user-row';
import { makeFragmentData } from '~/gql';
import type { UserListQuery } from '~/gql/graphql';
import { UserListDocument } from '~/graphql/user';
import { LibraryTargetProvider } from '~/provider/library-target';
import { renderWithApollo } from '~/test-utils';

import { LibrarySwitcher } from '.';

const user = (overrides: {
  id?: string;
  username?: string;
  libraryId?: string;
  pendingBookRequestCount?: number;
}) => ({
  __typename: 'User' as const,
  ...makeFragmentData(
    {
      __typename: 'User' as const,
      id: overrides.id ?? 'u1',
      username: overrides.username ?? 'alice',
      progressCount: 0,
      pendingBookRequestCount: overrides.pendingBookRequestCount ?? 0,
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

  // Restored from pre-branch `efa830c6` (the final whole-branch review found
  // the branch had dropped it): the `userList.length === 0` half of the
  // self-heal guard. `loading: false` with an EMPTY list is
  // indistinguishable from "not fetched yet", so the persisted target must
  // survive it — without the guard an admin whose list came back empty (or
  // whose read has not landed) is silently dropped back to "Select a
  // library".
  //
  // The wait is on "Loading…" DISAPPEARING, not on the trigger existing: the
  // Select trigger is mounted from the very first render, so
  // `getByRole('button')` resolves before the response has arrived and would
  // make this fail OPEN (the exact defect the review found in the error case
  // below). Once "Loading…" is gone the response has landed and the
  // self-heal effect has already had its commit.
  //
  // Seen-to-fail: dropping `userList.length === 0` from the guard in
  // `./index.tsx` clears the key and this goes red on
  // `expect(...).toBe('lib-ghost')` (measured: `expected null to be
  // 'lib-ghost'`).
  it('keeps the persisted target when the user list is empty (not yet fetched)', async () => {
    localStorage.setItem('library-target-id', 'lib-ghost');
    renderAsAdmin([userListMock([])]);

    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    expect(localStorage.getItem('library-target-id')).toBe('lib-ghost');
  });

  // The error half of the same guard. The assertions below are chosen so
  // they can only hold AFTER the error has arrived: the previous shape of
  // this test waited on `getByRole('button')`, which the always-mounted
  // Select trigger satisfies on the FIRST render — so it asserted the
  // persisted target before the failure had even been delivered, and passed
  // whether or not the guard existed.
  //
  // MEASURED CAVEAT, recorded because it is not obvious and a future reader
  // will otherwise "simplify" the guard: `hasError` is NOT independently
  // discriminable by any test, and this one does not claim to pin it. Under
  // `errorPolicy: 'none'` (the client default, unset in
  // `provider/apollo/client.ts` and in `test-utils.tsx`) an errored read
  // yields `data: undefined`, so `userList` is `[]` at exactly the moment
  // `hasError` is `true` — the `userList.length === 0` clause already
  // returns first, and deleting `hasError` alone leaves this green. There is
  // no reachable state in this component with `hasError` true and a NON-empty
  // `userList`: the query takes no variables and is never refetched, so
  // Apollo never pairs an error with previous data here. `hasError` stands
  // as defence-in-depth against that pairing becoming reachable (an
  // `errorPolicy: 'all'` change, or a refetch being added), not as live,
  // separately-tested behaviour.
  //
  // Seen-to-fail (all three runs measured): reducing the guard to the
  // reviewer's exact mutation, `if (loading || targetLibraryId ===
  // undefined) return;`, turns BOTH this case and the empty-list case above
  // red on their localStorage assertions (`expected null to be
  // 'lib-ghost'`) — that same mutation left all 6 pre-fix tests in this file
  // green. Dropping only `userList.length === 0` reds the empty-list case
  // alone. Dropping only `hasError` reds NOTHING, per the caveat above.
  it('keeps the persisted target, and disables the switcher, when the user list errors', async () => {
    localStorage.setItem('library-target-id', 'lib-ghost');
    renderAsAdmin([userListErrorMock()]);

    // "Loading…" is the trigger's text ONLY while `loading` is true; its
    // replacement by the raw persisted id means the query has settled.
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    // `noUsers` (`!loading && userList.length === 0`) is true only once the
    // failure has landed, and it is what disables the trigger — `tabIndex`
    // flips to -1. A still-loading or still-populated switcher is focusable.
    expect(screen.getByRole('button', { name: 'lib-ghost' })).toHaveAttribute('tabindex', '-1');
    expect(localStorage.getItem('library-target-id')).toBe('lib-ghost');
  });

  // The description text only renders inside the option list, which the
  // `Select` control mounts through `Popover` (a portal) only while open —
  // same wait-then-click pattern as the "stores the selected user's library
  // id" case above.
  it('shows a request count for users who have pending requests', async () => {
    renderAsAdmin([
      userListMock([user({ username: 'bob', libraryId: 'lib-bob', pendingBookRequestCount: 2 })]),
    ]);
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Select library…' }));
    expect(await screen.findByText('2 requests')).toBeInTheDocument();
  });

  it('singularises a count of one', async () => {
    renderAsAdmin([
      userListMock([user({ username: 'bob', libraryId: 'lib-bob', pendingBookRequestCount: 1 })]),
    ]);
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Select library…' }));
    expect(await screen.findByText('1 request')).toBeInTheDocument();
  });

  it('shows no count for a user with none, and keeps the label the bare username', async () => {
    renderAsAdmin([
      userListMock([
        user({ username: 'alice', libraryId: 'lib-alice', pendingBookRequestCount: 0 }),
      ]),
    ]);
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Select library…' }));
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.queryByText(/request/i)).not.toBeInTheDocument();
  });
});

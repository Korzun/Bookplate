import type { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The pending badge navigates via `useNavigate` and selects a library via
// `useLibraryTarget`, both mocked here the same way `component/book-row/
// from-entry.test.tsx` mocks `useNavigate` — `vi.hoisted` so the spies exist
// before `vi.mock`'s factory runs. `~/provider/library-target` is a plain
// factory (no `importOriginal()`), so this does not cross into the
// circular-import cycle `test-utils.tsx`'s standing note warns about.
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), setTargetLibraryId: vi.fn() }));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});
vi.mock('~/provider/library-target', () => ({
  useLibraryTarget: () => [undefined, mocks.setTargetLibraryId],
}));

import { makeFragmentData } from '~/gql';
import type {
  UserClearEmailMutation,
  UserClearEmailMutationVariables,
  UserDeleteMutation,
  UserDeleteMutationVariables,
  UserRowFragmentFragment,
} from '~/gql/graphql';
import { UserClearEmailDocument, UserDeleteDocument } from '~/graphql/user';
import { UserListDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { UserRow, UserRowFragment } from './index';

// UserRow renders a ConfirmModal (for delete), which calls the native
// <dialog> showModal/close methods jsdom does not implement.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  Object.assign(navigator, { clipboard: { writeText: () => Promise.resolve() } });
});

/**
 * A typed `UserRowFragmentFragment` VARIABLE, never an inline object literal
 * at a call site — see `component/device-row/index.test.tsx`'s identical
 * note on why a fresh literal fails TypeScript's excess-property check
 * against `UserRow`'s MASKED `user` prop, and why `makeFragmentData` is the
 * sanctioned cast back to that masked type.
 */
const user = (
  overrides: Partial<{
    id: string;
    username: string;
    pendingBookRequestCount: number;
    email: string | null;
    emailVerifiedAt: string | null;
  }> = {}
): UserRowFragmentFragment => ({
  __typename: 'User',
  id: overrides.id ?? 'u1',
  username: overrides.username ?? 'alice',
  pendingBookRequestCount: overrides.pendingBookRequestCount ?? 0,
  email: overrides.email ?? null,
  emailVerifiedAt: overrides.emailVerifiedAt ?? null,
});

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.setTargetLibraryId.mockClear();
});

// Writes the row into a REAL, normalized `InMemoryCache` (via `writeQuery`,
// not a bare `writeFragment` shortcut) so `User:<id>` genuinely exists as an
// entity before a delete test runs — otherwise `cache.evict` would be
// evicting nothing, and an assertion that the entity is gone would pass
// vacuously whether or not the eviction code ran at all.
const seedUserEntity = (client: ApolloClient, row: UserRowFragmentFragment) =>
  client.writeQuery({
    query: UserListDocument,
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        users: [{ ...row, library: { __typename: 'Library', id: 'lib-1' } }],
      },
    },
  });

const deleteSuccessMock = (
  userId: string
): MockedResponse<UserDeleteMutation, UserDeleteMutationVariables> => ({
  request: { query: UserDeleteDocument, variables: { input: { userId } } },
  result: {
    data: {
      __typename: 'Mutation',
      userDelete: { __typename: 'UserDeletePayload', deletedId: userId },
    },
  },
});

const deleteNetworkErrorMock = (
  userId: string
): MockedResponse<UserDeleteMutation, UserDeleteMutationVariables> => ({
  request: { query: UserDeleteDocument, variables: { input: { userId } } },
  error: new Error('Network error'),
});

const clearEmailSuccessMock = (
  userId: string
): MockedResponse<UserClearEmailMutation, UserClearEmailMutationVariables> => ({
  request: { query: UserClearEmailDocument, variables: { input: { userId } } },
  result: {
    data: {
      __typename: 'Mutation',
      userClearEmail: {
        __typename: 'UserClearEmailPayload',
        user: { __typename: 'User', id: userId, email: null, emailVerifiedAt: null },
      },
    },
  },
});

// The server resolves `userClearEmail` to a bare `null` both when the
// target user has vanished AND when it is the (indistinguishable)
// config-admin row — see `user/mutation/clear-email.ts`'s doc comment.
// Neither case is an error the server described, so this must not read as
// one, but it is also not a success: the row's address is unchanged.
const clearEmailNullMock = (
  userId: string
): MockedResponse<UserClearEmailMutation, UserClearEmailMutationVariables> => ({
  request: { query: UserClearEmailDocument, variables: { input: { userId } } },
  result: { data: { __typename: 'Mutation', userClearEmail: null } },
});

// Anchored, not a bare substring match: the collapsible `Card` header is
// ITSELF a `role="button"` whose accessible name concatenates all of its
// descendants' text — including "Delete user" — so an unanchored
// `/delete user/i` matches both that header AND the actual button.
const clickConfirmDelete = async (userEventInstance: ReturnType<typeof userEvent.setup>) => {
  await userEventInstance.click(screen.getByRole('button', { name: /^delete user$/i }));
  const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
  await userEventInstance.click(deleteButtons[deleteButtons.length - 1]);
};

// `ResetPasswordButton` (in the header) renders its OWN `<dialog>` — a
// `container.querySelector('dialog')` would ambiguously grab whichever one
// comes first in DOM order, not necessarily the delete-confirm dialog under
// test. This finds the one whose body contains the delete-specific title.
const findDeleteDialog = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('dialog')).find((dialog) =>
    dialog.textContent?.includes('Delete user permanently?')
  );

describe('UserRow', () => {
  it('renders the username, and no longer a progress subtitle', () => {
    renderWithApollo(
      <UserRow user={makeFragmentData(user({ username: 'alice' }), UserRowFragment)} />
    );

    expect(screen.getAllByText('alice').length).toBeGreaterThanOrEqual(1);
    // The "N books synced" subtitle is gone, and with it `progressCount` from
    // the fragment — the row names who the user is, not how much they have
    // read. `component/my-progress` still shows the viewer their own count,
    // off its own document.
    expect(screen.queryByText(/books? synced/i)).not.toBeInTheDocument();
  });

  // The pending-request badge is GONE. It existed as the entry point into
  // `/add/request` back when the library picker lived on individual pages;
  // the picker is global chrome on every page now, so the row no longer has
  // to carry a way in. `pendingBookRequestCount` itself stays on the
  // fragment — `component/library-switcher` shows it per option and
  // `component/nav` derives its dot from it.
  it('renders no pending-request badge, whatever the count', () => {
    renderWithApollo(
      <UserRow user={makeFragmentData(user({ pendingBookRequestCount: 2 }), UserRowFragment)} />
    );

    expect(screen.queryByText(/pending/i)).not.toBeInTheDocument();
    // Positive control: the row DID render, so this cannot pass vacuously.
    // `getAllBy`, because the username appears in more than one place on the
    // rendered row.
    expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
  });

  it('opens the confirm modal when Delete user is clicked, without sending a mutation', async () => {
    const userEventInstance = userEvent.setup();
    renderWithApollo(<UserRow user={makeFragmentData(user(), UserRowFragment)} />);

    await userEventInstance.click(screen.getByRole('button', { name: /^delete user$/i }));
    expect(screen.getByText(/delete user permanently\?/i)).toBeInTheDocument();
  });

  // Fixture-gap requirement: the entity is seeded into a REAL InMemoryCache
  // and `UserDeleteDocument` is sent for real (via `MockLink`) — proving the
  // row wires its unmasked `unmasked.id` into the mutation, and that the
  // `update` callback evicts the entity from the cache.
  it('sends UserDelete with the user id and evicts it from the cache when confirmed', async () => {
    const userEventInstance = userEvent.setup();
    const row = user({ id: 'u1' });
    const { client, container } = renderWithApollo(
      <UserRow user={makeFragmentData(row, UserRowFragment)} />,
      { mocks: [deleteSuccessMock('u1')] }
    );
    seedUserEntity(client, row);

    await clickConfirmDelete(userEventInstance);

    await waitFor(() => {
      const extracted = client.cache.extract() as NormalizedCacheObject;
      expect(Object.keys(extracted)).not.toContain('User:u1');
    });
    await waitFor(() => expect(findDeleteDialog(container)?.hasAttribute('open')).toBe(false));
  });

  it('surfaces a network error inline and keeps the modal open, without an unhandled rejection', async () => {
    const userEventInstance = userEvent.setup();
    const row = user({ id: 'u1' });
    const { client, container } = renderWithApollo(
      <UserRow user={makeFragmentData(row, UserRowFragment)} />,
      { mocks: [deleteNetworkErrorMock('u1')] }
    );
    seedUserEntity(client, row);

    await clickConfirmDelete(userEventInstance);

    expect(await screen.findByText('Network error')).toBeInTheDocument();
    expect(findDeleteDialog(container)?.hasAttribute('open')).toBe(true);
    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(Object.keys(extracted)).toContain('User:u1');
  });

  it('shows a confirmed address', () => {
    renderWithApollo(
      <UserRow
        user={makeFragmentData(
          user({ email: 'ann@example.com', emailVerifiedAt: new Date().toISOString() }),
          UserRowFragment
        )}
      />
    );

    expect(screen.getByText('ann@example.com')).toBeInTheDocument();
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
  });

  it('marks an unconfirmed address as not confirmed', () => {
    renderWithApollo(
      <UserRow
        user={makeFragmentData(
          user({ email: 'ann@example.com', emailVerifiedAt: null }),
          UserRowFragment
        )}
      />
    );

    expect(screen.getByText(/not confirmed/i)).toBeInTheDocument();
  });

  it('offers no clear action when the user has no address', () => {
    renderWithApollo(
      <UserRow
        user={makeFragmentData(user({ email: null, emailVerifiedAt: null }), UserRowFragment)}
      />
    );

    // Positive control: the row DID render, so this cannot pass vacuously.
    expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /clear address/i })).toBeNull();
  });

  it('warns that the user will be asked to set a new address, then clears it', async () => {
    const userEventInstance = userEvent.setup();
    renderWithApollo(
      <UserRow
        user={makeFragmentData(
          user({ id: 'u1', email: 'ann@example.com', emailVerifiedAt: null }),
          UserRowFragment
        )}
      />,
      { mocks: [clearEmailSuccessMock('u1')] }
    );

    await userEventInstance.click(screen.getByRole('button', { name: /^clear address$/i }));
    // The consequence must be stated before the operator confirms: clearing
    // re-gates the user, because `mustSetEmail` is derived from `email ==
    // null`.
    expect(await screen.findByText(/asked to set (a new )?(an )?address/i)).toBeInTheDocument();

    await userEventInstance.click(screen.getByRole('button', { name: /^clear$/i }));
    await waitFor(() => expect(screen.queryByText('ann@example.com')).toBeNull());
  });

  // The server's own union resolves to a bare `null` both when the user is
  // gone AND when the target is the (indistinguishable) config-admin row —
  // see `user/mutation/clear-email.ts`. Neither is an error the server
  // described, so this must not render as one, but it is also not the
  // success path: the address must still be showing afterward, and the
  // modal must still be open (mirrors `handleDeleteUserConfirm`'s own
  // "missing" branch, which never closes the modal either).
  it('shows a message and keeps the modal open when the clear resolves to null', async () => {
    const userEventInstance = userEvent.setup();
    const { container } = renderWithApollo(
      <UserRow
        user={makeFragmentData(
          user({ id: 'u1', email: 'ann@example.com', emailVerifiedAt: null }),
          UserRowFragment
        )}
      />,
      { mocks: [clearEmailNullMock('u1')] }
    );

    await userEventInstance.click(screen.getByRole('button', { name: /^clear address$/i }));
    await userEventInstance.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(await screen.findByText(/could not clear/i)).toBeInTheDocument();
    // Not the success path: the address is still there, and the confirm
    // dialog is still open (a genuine payload is the only thing that closes
    // it — see `handleClearEmailConfirm`).
    expect(screen.getByText('ann@example.com')).toBeInTheDocument();
    const dialog = Array.from(container.querySelectorAll('dialog')).find((d) =>
      d.textContent?.includes('Clear this address?')
    );
    expect(dialog?.hasAttribute('open')).toBe(true);
  });
});

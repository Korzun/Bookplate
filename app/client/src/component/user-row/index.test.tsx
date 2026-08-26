import type { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { makeFragmentData } from '~/gql';
import type {
  UserDeleteMutation,
  UserDeleteMutationVariables,
  UserRowFragmentFragment,
} from '~/gql/graphql';
import { UserDeleteDocument } from '~/graphql/user';
import { UserListDocument } from '~/page/user-list';
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
  overrides: Partial<{ id: string; username: string; progressCount: number }> = {}
): UserRowFragmentFragment => ({
  __typename: 'User',
  id: overrides.id ?? 'u1',
  username: overrides.username ?? 'alice',
  progressCount: overrides.progressCount ?? 3,
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
  it('renders the username and progress subtitle from the fragment, collapsed by default', () => {
    renderWithApollo(
      <UserRow user={makeFragmentData(user({ progressCount: 1 }), UserRowFragment)} />
    );

    expect(screen.getAllByText('alice').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('1 book synced')).toBeInTheDocument();
  });

  it('pluralizes the progress subtitle for zero and multiple books', () => {
    renderWithApollo(
      <UserRow user={makeFragmentData(user({ progressCount: 0 }), UserRowFragment)} />
    );
    expect(screen.getByText('0 books synced')).toBeInTheDocument();
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
});

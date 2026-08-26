import type { NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  SyncPasswordQuery,
  UserRegenerateSyncPasswordMutation,
  UserRegenerateSyncPasswordMutationVariables,
  ViewerBootstrapQuery,
} from '~/gql/graphql';
import { SyncPasswordDocument, UserRegenerateSyncPasswordDocument } from '~/graphql/user';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { renderWithApollo } from '~/test-utils';

import { SyncPassword } from './index';

// ConfirmModal renders a native <dialog>, whose showModal/close jsdom does
// not implement.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const syncPasswordMock = (syncPassword: string | null): MockedResponse<SyncPasswordQuery> => ({
  request: { query: SyncPasswordDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: { __typename: 'Viewer', syncPassword },
    },
  },
});

const syncPasswordErrorMock = (): MockedResponse<SyncPasswordQuery> => ({
  request: { query: SyncPasswordDocument },
  error: new Error('sync password query failed'),
});

// `userId` is `null` for the config-based admin (no `viewer.user` row) — the
// component's `if (!userId)` guard exists specifically for this shape.
const viewerBootstrapMock = (userId: string | null): MockedResponse<ViewerBootstrapQuery> => ({
  request: { query: ViewerBootstrapDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        username: 'admin',
        isAdmin: userId === null,
        mustChangePassword: false,
        user: userId ? { __typename: 'User', id: userId } : null,
        library: null,
      },
    },
  },
});

const regenerateSuccessMock = (
  userId: string,
  newSyncPassword: string
): MockedResponse<
  UserRegenerateSyncPasswordMutation,
  UserRegenerateSyncPasswordMutationVariables
> => ({
  request: { query: UserRegenerateSyncPasswordDocument, variables: { input: { userId } } },
  result: {
    data: {
      __typename: 'Mutation',
      userRegenerateSyncPassword: {
        __typename: 'UserRegenerateSyncPasswordPayload',
        syncPassword: newSyncPassword,
        user: { __typename: 'User', id: userId },
      },
    },
  },
});

// Both the header "Regenerate" button and the confirm modal's own confirm
// button share the label "Regenerate" — the confirm button is the last one
// in document order (same pattern as `component/user-row/index.test.tsx`'s
// `clickConfirmDelete`).
const clickConfirmRegenerate = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Regenerate' }));
  const regenerateButtons = screen.getAllByRole('button', { name: 'Regenerate', hidden: true });
  await user.click(regenerateButtons[regenerateButtons.length - 1]);
};

describe('SyncPassword', () => {
  // (a) The `cache.modify` write onto `Viewer.syncPassword`. Seeds a REAL
  // normalized `InMemoryCache` via `writeQuery` first (mirrors
  // `component/user-row/index.test.tsx`'s `seedUserEntity` and
  // `component/device-row/index.test.tsx`'s `seedDeviceEntity`), so
  // asserting the cache afterward is not vacuous: if the `update` callback
  // were deleted, the mutation would still succeed and the rendered card
  // would still show the new password (from local `newPassword` state), but
  // the NORMALIZED cache would still hold the OLD value — exactly the
  // silent-stale-cache regression this test exists to catch.
  it('writes the regenerated password onto the normalized Viewer.syncPassword entry', async () => {
    const user = userEvent.setup();
    const { client } = renderWithApollo(<SyncPassword />, {
      mocks: [
        syncPasswordMock('old-pass'),
        viewerBootstrapMock('u1'),
        regenerateSuccessMock('u1', 'new-pass'),
      ],
    });
    client.writeQuery({
      query: SyncPasswordDocument,
      data: { __typename: 'Query', viewer: { __typename: 'Viewer', syncPassword: 'old-pass' } },
    });

    await waitFor(() => expect(screen.getByText('old-pass')).toBeInTheDocument());
    await clickConfirmRegenerate(user);

    await waitFor(() => expect(screen.getByText('new-pass')).toBeInTheDocument());

    const viewerId = client.cache.identify({ __typename: 'Viewer' });
    expect(viewerId).toBeDefined();
    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(extracted[viewerId!]?.['syncPassword']).toBe('new-pass');
  });

  // (b) The `if (!userId)` guard. The config-based admin has no `viewer.user`
  // row (`ViewerBootstrapDocument` resolves `user: null`), so `userId` is
  // `undefined` — the guard must stop `runRegenerate` from ever firing,
  // rather than sending `{ input: { userId: undefined } }`. A `vi.fn`
  // variables matcher (not just a message-text assertion, which a caught
  // MockLink "no more responses" error would produce identically either
  // way) proves the mutation itself was never invoked.
  it('does not call the mutation when there is no viewer.user id (config-based admin)', async () => {
    const user = userEvent.setup();
    const matcher = vi.fn(() => true);
    renderWithApollo(<SyncPassword />, {
      mocks: [
        syncPasswordMock(null),
        viewerBootstrapMock(null),
        {
          request: { query: UserRegenerateSyncPasswordDocument, variables: matcher },
          result: {
            data: {
              __typename: 'Mutation',
              userRegenerateSyncPassword: {
                __typename: 'UserRegenerateSyncPasswordPayload',
                syncPassword: 'should-not-be-used',
                user: { __typename: 'User', id: 'irrelevant' },
              },
            },
          },
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('—')).toBeInTheDocument());
    await clickConfirmRegenerate(user);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Failed to regenerate device password'
    );
    expect(matcher).not.toHaveBeenCalled();
  });

  // (c) The fetch-error branch, and a null syncPassword NOT being treated as
  // an error.
  it('shows the fetch-error message when SyncPassword errors', async () => {
    renderWithApollo(<SyncPassword />, {
      mocks: [syncPasswordErrorMock(), viewerBootstrapMock('u1')],
    });

    expect(await screen.findByText('Failed to load device password.')).toBeInTheDocument();
  });

  it('renders a null syncPassword as "—", not as an error', async () => {
    renderWithApollo(<SyncPassword />, {
      mocks: [syncPasswordMock(null), viewerBootstrapMock(null)],
    });

    await waitFor(() => expect(screen.getByText('—')).toBeInTheDocument());
    expect(screen.queryByText('Failed to load device password.')).not.toBeInTheDocument();
  });
});

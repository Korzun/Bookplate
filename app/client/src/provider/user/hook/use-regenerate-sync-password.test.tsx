import type { ApolloClient } from '@apollo/client';
import { useApolloClient } from '@apollo/client/react';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SyncPasswordDocument, UserRegenerateSyncPasswordDocument } from '~/graphql/user';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { renderWithApollo } from '~/test-utils';

import {
  useRegenerateSyncPassword,
  type UseRegenerateSyncPassword,
} from './use-regenerate-sync-password';

const viewerMock = (userId: string | null) => ({
  request: { query: ViewerBootstrapDocument },
  result: {
    data: {
      __typename: 'Query' as const,
      viewer: {
        __typename: 'Viewer' as const,
        username: userId ? 'alice' : 'admin',
        isAdmin: userId === null,
        mustChangePassword: false,
        user: userId ? { __typename: 'User' as const, id: userId } : null,
        library: null,
      },
    },
  },
});

const regenerateSuccessMock = {
  request: {
    query: UserRegenerateSyncPasswordDocument,
    variables: { input: { userId: 'USER-1' } },
  },
  result: {
    data: {
      __typename: 'Mutation' as const,
      userRegenerateSyncPassword: {
        __typename: 'UserRegenerateSyncPasswordPayload' as const,
        syncPassword: 'swift stone',
        user: { __typename: 'User' as const, id: 'USER-1' },
      },
    },
  },
};

type Harness = { regenerate: UseRegenerateSyncPassword; client: ApolloClient };

const renderRegenerateSyncPassword = (
  mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']
) => {
  const result: { current?: Harness } = {};
  const Probe = () => {
    result.current = { regenerate: useRegenerateSyncPassword(), client: useApolloClient() };
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

/** Seeds a `SyncPassword` cache read, mirroring the state before regeneration. */
const seedSyncPassword = (client: ApolloClient, syncPassword: string | null) =>
  client.writeQuery({
    query: SyncPasswordDocument,
    data: { __typename: 'Query', viewer: { __typename: 'Viewer', syncPassword } },
  });

/**
 * Waits for the `ViewerBootstrap` mock to actually resolve into the cache
 * before a test calls `regenerate()` — otherwise `userId` is still
 * `undefined` on the first render and every call takes the "no userId"
 * branch regardless of which mock array the test supplied.
 */
const waitForViewerBootstrap = (client: ApolloClient) =>
  waitFor(() => expect(client.readQuery({ query: ViewerBootstrapDocument })).not.toBeNull());

describe('useRegenerateSyncPassword', () => {
  it('returns a regenerate function and initial false/null/false state', () => {
    const result = renderRegenerateSyncPassword([viewerMock('USER-1')]);
    const [regenerate, loading, syncPassword, error] = result.current!.regenerate;
    expect(typeof regenerate).toBe('function');
    expect(loading).toBe(false);
    expect(syncPassword).toBeNull();
    expect(error).toBe(false);
  });

  it('sends the mutation and returns the new syncPassword', async () => {
    const result = renderRegenerateSyncPassword([viewerMock('USER-1'), regenerateSuccessMock]);
    await waitForViewerBootstrap(result.current!.client);
    seedSyncPassword(result.current!.client, 'old pass');

    const ok = await act(() => result.current!.regenerate[0]());
    expect(ok).toBe(true);
    expect(result.current!.regenerate[2]).toBe('swift stone');
    expect(result.current!.regenerate[3]).toBe(false);
  });

  // The task's real content: `userRegenerateSyncPassword` returns
  // `{ syncPassword, user }`, but the field the UI reads is
  // `Viewer.syncPassword` — a different place entirely. This proves the
  // `cache.modify` on the `Viewer` singleton actually ran, by reading a
  // SEPARATE cached `SyncPassword` query, not the mutation's own payload —
  // reading the payload (the assertion above) would pass even with the
  // `cache.modify` missing.
  it('updates the cached viewer.syncPassword so a subsequent SyncPassword read sees the new value', async () => {
    const result = renderRegenerateSyncPassword([viewerMock('USER-1'), regenerateSuccessMock]);
    await waitForViewerBootstrap(result.current!.client);
    seedSyncPassword(result.current!.client, 'old pass');

    await act(() => result.current!.regenerate[0]());

    const cached = result.current!.client.readQuery({ query: SyncPasswordDocument });
    expect(cached?.viewer.syncPassword).toBe('swift stone');
  });

  it('sets error and returns false on a missing (null) mutation result', async () => {
    const result = renderRegenerateSyncPassword([
      viewerMock('USER-1'),
      {
        request: {
          query: UserRegenerateSyncPasswordDocument,
          variables: { input: { userId: 'USER-1' } },
        },
        result: { data: { __typename: 'Mutation' as const, userRegenerateSyncPassword: null } },
      },
    ]);
    await waitForViewerBootstrap(result.current!.client);
    seedSyncPassword(result.current!.client, 'old pass');

    const ok = await act(() => result.current!.regenerate[0]());
    expect(ok).toBe(false);
    expect(result.current!.regenerate[3]).toBe(true);

    const cached = result.current!.client.readQuery({ query: SyncPasswordDocument });
    expect(cached?.viewer.syncPassword).toBe('old pass');
  });

  it('sets error and returns false when the mutation throws', async () => {
    const result = renderRegenerateSyncPassword([
      viewerMock('USER-1'),
      {
        request: {
          query: UserRegenerateSyncPasswordDocument,
          variables: { input: { userId: 'USER-1' } },
        },
        error: new Error('Network error'),
      },
    ]);
    await waitForViewerBootstrap(result.current!.client);
    seedSyncPassword(result.current!.client, 'old pass');

    const ok = await act(() => result.current!.regenerate[0]());
    expect(ok).toBe(false);
    expect(result.current!.regenerate[3]).toBe(true);
  });

  // `viewer.user` is null for the config-based admin, so there is no `User`
  // global ID to send — `SyncPassword` is only ever mounted for a non-admin
  // viewer in the app (`page/user/index.tsx`), so this is a defensive path,
  // not one this hook's real callers exercise. No mutation mock is provided;
  // if the hook attempted to call it anyway, MockLink would fail the test.
  it('sets error and returns false without calling the mutation when viewer.user is null', async () => {
    const result = renderRegenerateSyncPassword([viewerMock(null)]);
    await waitForViewerBootstrap(result.current!.client);

    const ok = await act(() => result.current!.regenerate[0]());
    expect(ok).toBe(false);
    expect(result.current!.regenerate[3]).toBe(true);
  });

  it('sets loading to true while the mutation is pending', async () => {
    const result = renderRegenerateSyncPassword([
      viewerMock('USER-1'),
      { ...regenerateSuccessMock, delay: 20 },
    ]);
    await waitForViewerBootstrap(result.current!.client);
    seedSyncPassword(result.current!.client, 'old pass');

    act(() => {
      void result.current!.regenerate[0]();
    });
    await waitFor(() => expect(result.current!.regenerate[1]).toBe(true));
    await waitFor(() => expect(result.current!.regenerate[1]).toBe(false));
  });
});

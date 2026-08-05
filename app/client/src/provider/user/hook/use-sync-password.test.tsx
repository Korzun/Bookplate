import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SyncPasswordDocument } from '~/graphql/user';
import { renderWithApollo } from '~/test-utils';

import { useSyncPassword, type UseSyncPassword } from './use-sync-password';

const syncPasswordMock = (syncPassword: string | null) => ({
  request: { query: SyncPasswordDocument },
  result: {
    data: {
      __typename: 'Query' as const,
      viewer: { __typename: 'Viewer' as const, syncPassword },
    },
  },
});

const renderSyncPassword = (
  mocks: NonNullable<Parameters<typeof renderWithApollo>[1]>['mocks']
) => {
  const result: { current?: UseSyncPassword } = {};
  const Probe = () => {
    result.current = useSyncPassword();
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

describe('useSyncPassword', () => {
  it('returns the syncPassword once the query resolves', async () => {
    const result = renderSyncPassword([syncPasswordMock('blue oak')]);

    await waitFor(() => expect(result.current?.[1]).toBe(false));
    expect(result.current?.[0]).toBe('blue oak');
    expect(result.current?.[2]).toBe(false);
  });

  // `Viewer.syncPassword` resolves to a clean `null` for the config-based
  // admin (no `authScopes`, no accompanying error) — that is "not applicable
  // to this account", not a failure, so no error flag should be set here.
  it('treats a null syncPassword (config-based admin) as not-an-error', async () => {
    const result = renderSyncPassword([syncPasswordMock(null)]);

    await waitFor(() => expect(result.current?.[1]).toBe(false));
    expect(result.current?.[0]).toBeNull();
    expect(result.current?.[2]).toBe(false);
  });

  it('sets error on a GraphQL/network failure', async () => {
    const result = renderSyncPassword([
      {
        request: { query: SyncPasswordDocument },
        error: new Error('Network error'),
      },
    ]);

    await waitFor(() => expect(result.current?.[2]).toBe(true));
    expect(result.current?.[0]).toBeNull();
  });

  it('reports loading until the query resolves', () => {
    const result = renderSyncPassword([syncPasswordMock('blue oak')]);

    expect(result.current?.[1]).toBe(true);
    expect(result.current?.[0]).toBeNull();
  });
});

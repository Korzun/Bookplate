import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { renderWithApollo } from '~/test-utils';

import { useCurrentLibraryId } from './use-current-library-id';

const viewerMock = (library: { __typename: 'Library'; id: string } | null, isAdmin: boolean) => ({
  request: { query: ViewerBootstrapDocument },
  result: {
    data: {
      __typename: 'Query' as const,
      viewer: {
        __typename: 'Viewer' as const,
        username: isAdmin ? 'admin' : 'alice',
        isAdmin,
        mustChangePassword: false,
        user: isAdmin ? null : { __typename: 'User' as const, id: 'USER-1' },
        library,
      },
    },
  },
});

/** Renders the hook inside renderWithApollo's provider stack. */
const renderCurrentLibraryId = (mocks: ReturnType<typeof viewerMock>[]) => {
  const result: { current?: ReturnType<typeof useCurrentLibraryId> } = {};
  const Probe = () => {
    result.current = useCurrentLibraryId();
    return null;
  };
  renderWithApollo(<Probe />, { mocks });
  return result;
};

describe('useCurrentLibraryId', () => {
  it('returns the self library id for a regular user', async () => {
    const result = renderCurrentLibraryId([
      viewerMock({ __typename: 'Library', id: 'LIB-SELF' }, false),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.libraryId).toBe('LIB-SELF');
  });

  it('returns undefined for an admin, whose viewer.library is null', async () => {
    const result = renderCurrentLibraryId([viewerMock(null, true)]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.libraryId).toBeUndefined();
  });

  it('reports loading until the bootstrap query resolves', () => {
    const result = renderCurrentLibraryId([
      viewerMock({ __typename: 'Library', id: 'LIB-SELF' }, false),
    ]);

    expect(result.current?.loading).toBe(true);
    expect(result.current?.libraryId).toBeUndefined();
  });
});

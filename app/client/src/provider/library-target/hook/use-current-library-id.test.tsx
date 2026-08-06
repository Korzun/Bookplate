import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { renderWithApollo } from '~/test-utils';

import { LibraryTargetProvider } from '../provider';
import { useCurrentLibraryId } from './use-current-library-id';

const STORAGE_KEY = 'library-target-id';

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

/**
 * Renders the hook inside renderWithApollo's provider stack, wrapped in a
 * REAL `LibraryTargetProvider` — `useCurrentLibraryId` now reads
 * `useLibraryTarget()`, which is backed by `localStorage`, so a bare Apollo
 * mock is no longer enough to exercise it.
 */
const renderCurrentLibraryId = (mocks: ReturnType<typeof viewerMock>[]) => {
  const result: { current?: ReturnType<typeof useCurrentLibraryId> } = {};
  const Probe = () => {
    result.current = useCurrentLibraryId();
    return null;
  };
  renderWithApollo(
    <LibraryTargetProvider>
      <Probe />
    </LibraryTargetProvider>,
    { mocks }
  );
  return result;
};

describe('useCurrentLibraryId', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns the self library id for a regular user', async () => {
    const result = renderCurrentLibraryId([
      viewerMock({ __typename: 'Library', id: 'LIB-SELF' }, false),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.libraryId).toBe('LIB-SELF');
  });

  it('returns the stored selection for an admin', async () => {
    localStorage.setItem(STORAGE_KEY, 'LIB-TARGET');

    const result = renderCurrentLibraryId([viewerMock(null, true)]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.libraryId).toBe('LIB-TARGET');
  });

  it('returns viewer.library.id for a non-admin, ignoring any stored selection', async () => {
    // A non-admin has no legitimate way to populate this key, but nothing
    // stops them from writing to their own localStorage — the hook must not
    // let that read another library.
    localStorage.setItem(STORAGE_KEY, 'LIB-OTHER');

    const result = renderCurrentLibraryId([
      viewerMock({ __typename: 'Library', id: 'LIB-SELF' }, false),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.libraryId).toBe('LIB-SELF');
  });

  it('returns undefined for an admin with no selection', async () => {
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

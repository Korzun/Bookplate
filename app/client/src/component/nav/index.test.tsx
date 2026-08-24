import type { MockedResponse } from '@apollo/client/testing';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LibraryPendingFixesDocument } from '~/graphql/upload';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { renderWithApollo } from '~/test-utils';

import { Nav } from './index';

const LIBRARY_ID = 'TGlicmFyeTox';

/**
 * `Nav` renders `useUploadBadge()` unconditionally, which now reads
 * `usePendingFixes()` (Task 11) — a real `useQuery(ViewerBootstrapDocument)`
 * or every one of these tests throws "Could not find client in the
 * context" (no `ApolloProvider`). `renderWithProviders` alone (no Apollo) is
 * no longer enough; every render below goes through `renderWithApollo`.
 *
 * A non-admin's `ViewerBootstrap.viewer.library.id` resolves `usePendingFixes`
 * a real `libraryId`, so `LibraryPendingFixesDocument` needs its own mock
 * too. An admin has no `library-target-id` stored in these tests (no
 * `LibraryTargetProvider` wraps `renderWithApollo`, so `useLibraryTarget()`
 * falls back to its context default, `undefined`), so `usePendingFixes`
 * SKIPS its query for the admin cases below — no second mock needed there.
 */
const viewerBootstrapMock = (isAdmin: boolean): MockedResponse => ({
  request: { query: ViewerBootstrapDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        username: isAdmin ? 'admin' : 'reader',
        isAdmin,
        mustChangePassword: false,
        user: isAdmin ? null : { __typename: 'User', id: 'USER-1' },
        library: isAdmin ? null : { __typename: 'Library', id: LIBRARY_ID },
      },
    },
  },
});

const emptyPendingFixesMock: MockedResponse = {
  request: { query: LibraryPendingFixesDocument, variables: { libraryId: LIBRARY_ID } },
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, pendingFixes: [] },
    },
  },
};

describe('Nav', () => {
  it('hides the Users tab for non-admins', () => {
    renderWithApollo(<Nav />, {
      user: { username: 'reader', isAdmin: false },
      initialEntries: ['/library'],
      mocks: [viewerBootstrapMock(false), emptyPendingFixesMock],
    });
    expect(screen.queryByText('Users')).toBeNull();
  });

  it('shows the Users tab for admins in both layouts', () => {
    renderWithApollo(<Nav />, {
      user: { username: 'admin', isAdmin: true },
      initialEntries: ['/library'],
      mocks: [viewerBootstrapMock(true)],
    });
    // One link in the desktop layout, one in the mobile layout (CSS hides the
    // off-breakpoint one). Query links so the mobile blue-reveal copy isn't counted.
    expect(screen.getAllByRole('link', { name: 'Users' })).toHaveLength(2);
  });

  it('marks the current route active in both layouts', () => {
    renderWithApollo(<Nav />, {
      user: { username: 'reader', isAdmin: false },
      initialEntries: ['/upload'],
      mocks: [viewerBootstrapMock(false), emptyPendingFixesMock],
    });
    const uploadLinks = screen.getAllByRole('link', { name: 'Upload' });
    expect(uploadLinks).toHaveLength(2);
    expect(uploadLinks.every((link) => link.getAttribute('aria-current') === 'page')).toBe(true);

    const libraryLinks = screen.getAllByRole('link', { name: 'Library' });
    expect(libraryLinks.every((link) => link.getAttribute('aria-current') === null)).toBe(true);
  });
});

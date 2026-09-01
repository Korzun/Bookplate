import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { LibraryPendingFixesQuery, LibraryPendingFixesQueryVariables } from '~/gql/graphql';
import { LibraryPendingFixesDocument } from '~/graphql/upload';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { useCurrentLibraryId } from '~/provider/library-target';
import { UploadContext } from '~/provider/upload/context';
import type { UploadItem, UseUploadQueue } from '~/provider/upload/hook/use-upload-queue';
import { renderWithApollo } from '~/test-utils';

import { Nav } from './index';

const LIBRARY_ID = 'TGlicmFyeTox';

/**
 * `Nav` reads `LibraryPendingFixesDocument` unconditionally for its upload
 * badge (Task 9 inlined it here from the dissolved `useUploadBadge`), which
 * needs a real `useQuery(ViewerBootstrapDocument)` underneath it — or every
 * one of these tests throws "Could not find client in the context" (no
 * `ApolloProvider`). `renderWithProviders` alone (no Apollo) is not enough;
 * every render below goes through `renderWithApollo`.
 *
 * A non-admin's `ViewerBootstrap.viewer.library.id` resolves a real
 * `libraryId`, so `LibraryPendingFixesDocument` needs its own mock too. An
 * admin has no `library-target-id` stored in these tests (no
 * `LibraryTargetProvider` wraps `renderWithApollo`, so `useLibraryTarget()`
 * falls back to its context default, `undefined`), so the badge read SKIPS
 * for the admin cases below — no second mock needed there, and the last test
 * in this file proves the skip rather than assuming it.
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

type PendingFixesMock = MockedResponse<LibraryPendingFixesQuery, LibraryPendingFixesQueryVariables>;

/** A row awaiting a decision: `proposals` non-empty. */
const proposalRow = (id: string) => ({
  __typename: 'PendingFix' as const,
  id,
  fileName: 'a.epub',
  fileSize: 1,
  book: { __typename: 'Book' as const, id: `BOOK-${id}`, title: 'X', author: 'Y' },
  state: {
    __typename: 'PendingFixState' as const,
    autoFixes: [],
    appliedFixes: [],
    proposals: [
      {
        __typename: 'MetadataFix' as const,
        field: 'title',
        kind: 'replace',
        from: 'a',
        to: 'b',
        reason: null,
        fromChips: null,
        toChips: null,
        changes: null,
      },
    ],
    undo: null,
  },
});

/** A row whose fixes have already been resolved: `proposals: []` with `undo`
 * armed — `Library.pendingFixes` still returns it for the TTL window
 * (`isLivePendingFix`), but it must NOT count toward the badge. */
const resolvedRow = (id: string) => ({
  ...proposalRow(id),
  state: {
    ...proposalRow(id).state,
    proposals: [],
    undo: { __typename: 'UndoSnapshot' as const, kind: 'APPLY' as const },
  },
});

const pendingFixesMock = (
  rows: (ReturnType<typeof proposalRow> | ReturnType<typeof resolvedRow>)[]
): PendingFixesMock => ({
  request: { query: LibraryPendingFixesDocument, variables: { libraryId: LIBRARY_ID } },
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, pendingFixes: rows },
    },
  },
});

const emptyPendingFixesMock: PendingFixesMock = pendingFixesMock([]);

const queueValue = (items: UploadItem[]): UseUploadQueue => ({
  items,
  addFiles: () => {},
  applyFix: async () => false,
  applyAllProposals: async () => false,
  dismissAllProposals: async () => false,
  dismissFix: async () => false,
  undo: async () => false,
  dismissCompleted: () => {},
});

/** `Nav` under an `UploadContext` carrying a chosen set of live transport
 * items — the only source for the badge's `active` half. */
const navWithQueue = (items: UploadItem[]): ReactElement => (
  <UploadContext.Provider value={queueValue(items)}>
    <Nav />
  </UploadContext.Provider>
);

const uploadingItem: UploadItem = {
  id: '1',
  fileName: 'a.epub',
  fileSize: 1,
  status: 'uploading',
  bytesUploaded: 0,
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
      initialEntries: ['/add'],
      mocks: [viewerBootstrapMock(false), emptyPendingFixesMock],
    });
    const uploadLinks = screen.getAllByRole('link', { name: 'Add' });
    expect(uploadLinks).toHaveLength(2);
    expect(uploadLinks.every((link) => link.getAttribute('aria-current') === 'page')).toBe(true);

    const libraryLinks = screen.getAllByRole('link', { name: 'Library' });
    expect(libraryLinks.every((link) => link.getAttribute('aria-current') === null)).toBe(true);
  });

  // ── The upload badge, inlined into `Nav` from the dissolved
  //    `useUploadBadge` (Task 9). Asserted on the RENDERED badge rather than a
  //    hook return value, which is what a reader of this component can see.

  it('badges the Upload tab with the number of books awaiting a fix decision', async () => {
    renderWithApollo(<Nav />, {
      user: { username: 'reader', isAdmin: false },
      initialEntries: ['/library'],
      mocks: [
        viewerBootstrapMock(false),
        pendingFixesMock([proposalRow('FIX-1'), proposalRow('FIX-2')]),
      ],
    });

    // One badge per layout (desktop + mobile); CSS hides the off-breakpoint
    // one, so both are in the DOM.
    await waitFor(() => expect(screen.getAllByText('2')).toHaveLength(2));
    // A count wins over the dot: nothing is uploading in this test anyway.
    expect(screen.queryAllByTestId('nav-badge-dot')).toHaveLength(0);
  });

  it('excludes a live row whose fixes are already fully resolved (proposals: [])', async () => {
    renderWithApollo(<Nav />, {
      user: { username: 'reader', isAdmin: false },
      initialEntries: ['/library'],
      mocks: [
        viewerBootstrapMock(false),
        pendingFixesMock([proposalRow('FIX-1'), resolvedRow('FIX-2')]),
      ],
    });

    await waitFor(() => expect(screen.getAllByText('1')).toHaveLength(2));
    expect(screen.queryByText('2')).toBeNull();
  });

  // `active` is the ONLY half of the badge the server cannot answer: it comes
  // from the client-side XHR transport queue, which is why the badge keeps two
  // sources rather than moving wholesale onto the pending-fix read.
  it('shows a dot, not a count, while an upload is in flight and the server has no pending fixes', async () => {
    renderWithApollo(navWithQueue([uploadingItem]), {
      user: { username: 'reader', isAdmin: false },
      initialEntries: ['/library'],
      mocks: [viewerBootstrapMock(false), emptyPendingFixesMock],
    });

    await waitFor(() => expect(screen.getAllByTestId('nav-badge-dot')).toHaveLength(2));
  });

  /**
   * An admin with no library target selected must not fire the badge read
   * with `libraryId: ''`.
   *
   * Counted through the VARIABLE MATCHER (Ruling Q) — `request.variables`
   * given a FUNCTION, which is where Apollo Client v4 puts it; a top-level
   * `variableMatcher` key is silently ignored and would make this test
   * fail-open. The matcher runs synchronously inside `MockLink.request()`,
   * before MockLink's delay, so a read that fired and was still in flight is
   * still caught. The counter increments BEFORE the `return` so a read with
   * the WRONG variables counts too.
   *
   * The settle is `useCurrentLibraryId().loading === false` rendered in a
   * sibling probe, not a `waitFor` on the DOM: the admin nav renders its final
   * shape immediately, so any DOM assertion would be satisfied before the
   * bootstrap had even resolved and would prove nothing about the skip.
   */
  it('does NOT fire the badge read for an admin with no library target', async () => {
    let requests = 0;
    const countingMock: PendingFixesMock = {
      request: {
        query: LibraryPendingFixesDocument,
        variables: (variables) => {
          requests += 1;
          return variables.libraryId === LIBRARY_ID;
        },
      },
      maxUsageCount: Number.POSITIVE_INFINITY,
      result: {
        data: {
          __typename: 'Query',
          node: { __typename: 'Library', id: LIBRARY_ID, pendingFixes: [] },
        },
      },
    };
    const settled: { loading?: boolean } = {};
    function TargetProbe() {
      settled.loading = useCurrentLibraryId().loading;
      return null;
    }

    renderWithApollo(
      <>
        <Nav />
        <TargetProbe />
      </>,
      {
        user: { username: 'admin', isAdmin: true },
        initialEntries: ['/library'],
        mocks: [viewerBootstrapMock(true), countingMock],
      }
    );

    await waitFor(() => expect(settled.loading).toBe(false));

    expect(requests).toBe(0);
    expect(screen.queryAllByTestId('nav-badge-dot')).toHaveLength(0);
  });
});

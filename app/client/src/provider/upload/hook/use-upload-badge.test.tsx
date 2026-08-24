import type { MockedResponse } from '@apollo/client/testing';
import { waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type {
  LibraryPendingFixesQuery,
  LibraryPendingFixesQueryVariables,
  ViewerBootstrapQuery,
} from '~/gql/graphql';
import { LibraryPendingFixesDocument } from '~/graphql/upload';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { renderHookWithApollo, renderWithApollo } from '~/test-utils';

import { UploadContext } from '../context';
import { useUploadBadge } from './use-upload-badge';
import type { UploadItem, UseUploadQueue } from './use-upload-queue';

const LIBRARY_ID = 'TGlicmFyeTox';

const viewerBootstrapMock: MockedResponse<ViewerBootstrapQuery> = {
  request: { query: ViewerBootstrapDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        username: 'u',
        isAdmin: false,
        mustChangePassword: false,
        user: { __typename: 'User', id: 'VXNlcjox' },
        library: { __typename: 'Library', id: LIBRARY_ID },
      },
    },
  },
};

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
        kind: 'x',
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

// A row whose fixes have already been resolved: `proposals: []` with `undo`
// armed — `Library.pendingFixes` still returns it for the TTL window
// (`isLivePendingFix`), but it must NOT count toward the badge.
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
): MockedResponse<LibraryPendingFixesQuery, LibraryPendingFixesQueryVariables> => ({
  request: { query: LibraryPendingFixesDocument, variables: { libraryId: LIBRARY_ID } },
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, pendingFixes: rows },
    },
  },
});

const base: UseUploadQueue = {
  items: [],
  addFiles: () => {},
  applyFix: async () => false,
  applyAllProposals: async () => false,
  dismissAllProposals: async () => false,
  dismissFix: async () => false,
  undo: async () => false,
  dismissCompleted: () => {},
};

function uploadingItem(overrides: Partial<UploadItem> = {}): UploadItem {
  return {
    id: '1',
    fileName: 'a.epub',
    fileSize: 1,
    status: 'uploading',
    bytesUploaded: 0,
    ...overrides,
  };
}

/** Renders `useUploadBadge` with a REAL `usePendingFixes()` (Apollo mocks)
 * and a chosen `UploadContext` value for `useUploadQueue()`'s `active`. */
function renderBadge(mocks: MockedResponse[], items: UploadItem[] = []) {
  const result: { current?: ReturnType<typeof useUploadBadge> } = {};
  function Probe() {
    result.current = useUploadBadge();
    return null;
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return <UploadContext.Provider value={{ ...base, items }}>{children}</UploadContext.Provider>;
  }
  renderWithApollo(
    <Wrapper>
      <Probe />
    </Wrapper>,
    { mocks }
  );
  return result;
}

describe('useUploadBadge', () => {
  it('counts books with pending proposals from the server, with no upload in flight', async () => {
    // Explicitly `MockedResponse[]`-typed, not an inline array literal —
    // `renderHookWithApollo`'s `mocks` is generic over a SINGLE `TData`,
    // inferred from the literal at each call site, which a mix of
    // `ViewerBootstrapQuery`/`LibraryPendingFixesQuery` mocks can't satisfy
    // (same fix `use-upload-queue.test.tsx`'s `renderEngine` uses).
    const mocks: MockedResponse[] = [
      viewerBootstrapMock,
      pendingFixesMock([proposalRow('FIX-1'), proposalRow('FIX-2')]),
    ];
    const { result } = renderHookWithApollo(() => useUploadBadge(), mocks);
    await waitFor(() => expect(result.current?.count).toBe(2));
    expect(result.current?.active).toBe(false);
  });

  it('excludes a live row whose fixes are already fully resolved (proposals: [])', async () => {
    const mocks: MockedResponse[] = [
      viewerBootstrapMock,
      pendingFixesMock([proposalRow('FIX-1'), resolvedRow('FIX-2')]),
    ];
    const { result } = renderHookWithApollo(() => useUploadBadge(), mocks);
    await waitFor(() => expect(result.current?.count).toBe(1));
  });

  it('reports active while an upload is in progress, independent of the server count', async () => {
    const result = renderBadge([viewerBootstrapMock, pendingFixesMock([])], [uploadingItem()]);
    await waitFor(() => expect(result.current?.active).toBe(true));
    expect(result.current?.count).toBe(0);
  });
});

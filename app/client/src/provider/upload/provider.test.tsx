import type { MockedResponse } from '@apollo/client/testing';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type {
  LibraryPendingFixesQuery,
  LibraryPendingFixesQueryVariables,
  UploadConfigQuery,
  ViewerBootstrapQuery,
} from '~/gql/graphql';
import { LibraryPendingFixesDocument, UploadConfigDocument } from '~/graphql/upload';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { renderWithApollo } from '~/test-utils';

import { useUploadQueue } from './hook/use-upload-queue';
import { UploadProvider } from './provider';

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

const configMock: MockedResponse<UploadConfigQuery> = {
  request: { query: UploadConfigDocument },
  result: {
    data: { __typename: 'Query', config: { __typename: 'Config', maxConcurrentUploads: 3 } },
  },
};

// The row is built by an unannotated factory (matching `use-pending-fixes
// .test.tsx`'s own convention) rather than written as an inline literal
// directly under the `MockedResponse<LibraryPendingFixesQuery, …>`-typed
// value below — assigning a fresh object literal straight into that position
// hits `Unmasked<>`'s masked-shape check (`PendingFix.id` "doesn't exist" on
// the still-masked fragment type); a variable reference gets ordinary
// (non-strict) structural assignability instead.
const pendingFixRow = () => ({
  __typename: 'PendingFix' as const,
  id: 'FIX-b1',
  fileName: 'x.epub',
  fileSize: 10,
  book: { __typename: 'Book' as const, id: 'b1', title: 'X', author: 'Y' },
  state: {
    __typename: 'PendingFixState' as const,
    autoFixes: [],
    appliedFixes: [],
    proposals: [
      {
        __typename: 'MetadataFix' as const,
        field: 'title',
        kind: 'k',
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

const pendingFixesMock: MockedResponse<
  LibraryPendingFixesQuery,
  LibraryPendingFixesQueryVariables
> = {
  request: { query: LibraryPendingFixesDocument, variables: { libraryId: LIBRARY_ID } },
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, pendingFixes: [pendingFixRow()] },
    },
  },
};

function Probe() {
  const { items } = useUploadQueue();
  return <div>count:{items.length}</div>;
}

describe('UploadProvider', () => {
  it('seeds the queue from the server pending-fixes on mount', async () => {
    renderWithApollo(
      <UploadProvider>
        <Probe />
      </UploadProvider>,
      { mocks: [viewerBootstrapMock, pendingFixesMock, configMock] }
    );

    expect(await screen.findByText('count:1')).toBeTruthy();
  });
});

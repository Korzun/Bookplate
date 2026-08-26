import type { MockedResponse } from '@apollo/client/testing';
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LibraryPendingFixesQuery, LibraryPendingFixesQueryVariables } from '~/gql/graphql';
import { LibraryPendingFixesDocument } from '~/graphql/upload';
import { renderHookWithApollo } from '~/test-utils';

import { usePendingFixes } from './use-pending-fixes';

const LIBRARY_ID = 'LIB-1';

// Same stub convention `use-book-validation.test.tsx` and
// `use-library-entries.test.tsx` use: `useCurrentLibraryId` is mocked
// directly rather than exercised through a real `ViewerBootstrapDocument` +
// `LibraryTargetProvider` stack, keeping these tests focused on
// `LibraryPendingFixesDocument` alone. `currentLibraryId`/`currentLibraryIdLoading`
// are mutable module-level state so individual tests can flip them.
let currentLibraryId: string | undefined = LIBRARY_ID;
let currentLibraryIdLoading = false;

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: currentLibraryIdLoading }),
}));

const pendingFixRow = (id: string) => ({
  __typename: 'PendingFix' as const,
  id,
  fileName: 'dune.epub',
  fileSize: 1024,
  book: { __typename: 'Book' as const, id: `BOOK-${id}`, title: 'Dune', author: 'Frank Herbert' },
  state: {
    __typename: 'PendingFixState' as const,
    autoFixes: [],
    appliedFixes: [],
    proposals: [
      {
        __typename: 'MetadataFix' as const,
        field: 'title',
        kind: 'replace',
        from: 'Old',
        to: 'Dune',
        reason: 'title mismatch',
        fromChips: null,
        toChips: null,
        changes: null,
      },
    ],
    undo: null,
  },
});

const pendingFixesMock = (
  rows: ReturnType<typeof pendingFixRow>[]
): MockedResponse<LibraryPendingFixesQuery, LibraryPendingFixesQueryVariables> => ({
  request: { query: LibraryPendingFixesDocument, variables: { libraryId: LIBRARY_ID } },
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, pendingFixes: rows },
    },
  },
});

describe('usePendingFixes', () => {
  it("reads the current library's pending fixes", async () => {
    const { result } = renderHookWithApollo(
      () => usePendingFixes(),
      [pendingFixesMock([pendingFixRow('FIX-1')])]
    );

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.rows).toHaveLength(1);
    expect(result.current?.rows[0]?.book.id).toBe('BOOK-FIX-1');
    expect(result.current?.rows[0]?.state.proposals).toHaveLength(1);
    expect(result.current?.error).toBeUndefined();
  });

  it('skips the query entirely while no library id is resolved', async () => {
    // An admin with no target selected must not fire a query with
    // libraryId: ''. No mocks at all: if the hook fired the query anyway,
    // MockLink would throw "No more mocked responses" and fail this test
    // loudly rather than let it pass vacuously.
    currentLibraryId = undefined;
    try {
      const { result } = renderHookWithApollo(() => usePendingFixes(), []);

      await waitFor(() => expect(result.current?.loading).toBe(false));
      expect(result.current?.rows).toEqual([]);
      expect(result.current?.error).toBeUndefined();
    } finally {
      currentLibraryId = LIBRARY_ID;
    }
  });

  // A SKIPPED `useQuery` reports `loading: false`, so without folding
  // `useCurrentLibraryId`'s own loading in, an admin whose target is still
  // resolving would render "no pending fixes" for a frame. Same correction
  // `page/library`'s `LibraryPage` carries (`page/library/index.tsx`'s own
  // `LibraryEntriesDocument`/`extraLoading` doc comment).
  it('reports loading while useCurrentLibraryId itself is still resolving, even though the query is skipped', () => {
    currentLibraryId = undefined;
    currentLibraryIdLoading = true;
    try {
      const { result } = renderHookWithApollo(() => usePendingFixes(), []);

      expect(result.current?.loading).toBe(true);
      expect(result.current?.rows).toEqual([]);
    } finally {
      currentLibraryId = LIBRARY_ID;
      currentLibraryIdLoading = false;
    }
  });

  it('refetches on demand', async () => {
    const { result } = renderHookWithApollo(
      () => usePendingFixes(),
      [
        pendingFixesMock([pendingFixRow('FIX-1')]),
        pendingFixesMock([pendingFixRow('FIX-1'), pendingFixRow('FIX-2')]),
      ]
    );

    await waitFor(() => expect(result.current?.rows).toHaveLength(1));

    result.current?.refetch();

    await waitFor(() => expect(result.current?.rows).toHaveLength(2));
  });
});

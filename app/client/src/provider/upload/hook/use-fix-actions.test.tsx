import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type {
  BookResolvePendingFixMutation,
  BookResolvePendingFixMutationVariables,
  LibraryEntriesQueryVariables,
} from '~/gql/graphql';
import { LibraryEntriesDocument } from '~/graphql/library';
import { BookResolvePendingFixDocument } from '~/graphql/upload';
import { renderHookWithApollo } from '~/test-utils';

import { useFixActions } from './use-fix-actions';

const BOOK_GID = 'BOOK-1';
const LIBRARY_ID = 'LIB-1';

// Matches `use-library-entries.ts`'s `PAGE_SIZE` default and its
// `filter: undefined` when no filter is applied — the exact variables the
// live grid reads `Library.entries` with.
const ENTRIES_VARS: LibraryEntriesQueryVariables = {
  libraryId: LIBRARY_ID,
  first: 20,
  filter: undefined,
};

// Deliberately UNANNOTATED — see `use-scan-library.test.tsx`'s identical
// `seededBook` comment: `LibraryEntriesQuery`'s `Book` node member is
// masked, so an explicitly typed literal here fails `tsc`'s excess-property
// check.
const seededBook = {
  __typename: 'Book' as const,
  id: BOOK_GID,
  title: 'Dune',
  author: 'Frank Herbert',
  seriesIndex: 0,
  hasCover: false,
  thumbnailUrl: '',
  progress: null,
};

const seedLibraryEntries = (client: ReturnType<typeof renderHookWithApollo>['client']) =>
  client.writeQuery({
    query: LibraryEntriesDocument,
    variables: ENTRIES_VARS,
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        entries: {
          __typename: 'LibraryEntriesConnection',
          edges: [{ __typename: 'LibraryEntriesConnectionEdge', cursor: 'c1', node: seededBook }],
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
  });

const readEntries = (client: ReturnType<typeof renderHookWithApollo>['client']) =>
  client.cache.readQuery({ query: LibraryEntriesDocument, variables: ENTRIES_VARS });

const okPayload = () => ({
  __typename: 'BookResolvePendingFixPayload' as const,
  book: { __typename: 'Book' as const, id: BOOK_GID, title: 'Dune', author: 'Frank Herbert' },
  library: { __typename: 'Library' as const, id: LIBRARY_ID, pendingFixes: [] },
});

type ResolveMock = MockedResponse<
  BookResolvePendingFixMutation,
  BookResolvePendingFixMutationVariables
>;

const acceptOneFixMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: {
      id: BOOK_GID,
      action: 'ACCEPT',
      fixes: [{ field: 'title', kind: 'replace', from: 'Old' }],
    },
  },
  result: { data: { __typename: 'Mutation', bookResolvePendingFix: okPayload() } },
};

// Keyed to the bulk-action variables — no `fixes` at all, matching what
// `acceptFixes(BOOK_GID)` (no second argument) actually sends. This proves
// the bulk path resolves against a mock shaped that way; it does NOT prove
// the hook would fail against a mock expecting `fixes: undefined` instead —
// `MockedResponse` variable matching treats an absent key and an explicit
// `undefined` value as equal (see `use-fix-actions.ts`'s own doc comment),
// so no test here can tell those two forms apart.
const acceptAllMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'ACCEPT' },
  },
  result: { data: { __typename: 'Mutation', bookResolvePendingFix: okPayload() } },
};

const dismissAllMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'DISMISS' },
  },
  result: { data: { __typename: 'Mutation', bookResolvePendingFix: okPayload() } },
};

const undoMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'UNDO' },
  },
  result: { data: { __typename: 'Mutation', bookResolvePendingFix: okPayload() } },
};

const clearMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'CLEAR' },
  },
  result: { data: { __typename: 'Mutation', bookResolvePendingFix: okPayload() } },
};

const acceptCollisionMock: ResolveMock = {
  request: {
    query: BookResolvePendingFixDocument,
    variables: { id: BOOK_GID, action: 'ACCEPT' },
  },
  result: {
    data: {
      __typename: 'Mutation',
      bookResolvePendingFix: {
        __typename: 'BookHashCollisionError',
        message: 'a book with that content already exists',
      },
    },
  },
};

describe('useFixActions', () => {
  it('accepts a single named fix', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [acceptOneFixMock]);

    await expect(
      result.current?.acceptFixes(BOOK_GID, [{ field: 'title', kind: 'replace', from: 'Old' }])
    ).resolves.toBe(true);
  });

  it('reports a typed error as false and surfaces its message', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [acceptCollisionMock]);

    await expect(result.current?.acceptFixes(BOOK_GID)).resolves.toBe(false);
    await waitFor(() =>
      expect(result.current?.error).toBe('a book with that content already exists')
    );
  });

  // Covers the bulk path: calling `acceptFixes` with no `fixes` argument
  // resolves against `acceptAllMock`, whose variables carry no `fixes` key.
  // This does NOT prove the hook omits the key rather than sending it as
  // `undefined` — see `acceptAllMock`'s own comment above for why no test
  // in this file can draw that distinction.
  it('resolves the bulk action when no fixes are named', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [acceptAllMock]);

    await expect(result.current?.acceptFixes(BOOK_GID)).resolves.toBe(true);
  });

  it('resolves the dismiss action when no fixes are named', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [dismissAllMock]);

    await expect(result.current?.dismissFixes(BOOK_GID)).resolves.toBe(true);
  });

  it('sends the UNDO action', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [undoMock]);

    await expect(result.current?.undoFixes(BOOK_GID)).resolves.toBe(true);
  });

  it('sends the CLEAR action', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [clearMock]);

    await expect(result.current?.clearFixes(BOOK_GID)).resolves.toBe(true);
  });

  it('reports a network failure as false and surfaces its message', async () => {
    const { result } = renderHookWithApollo(
      () => useFixActions(),
      [
        {
          request: {
            query: BookResolvePendingFixDocument,
            variables: { id: BOOK_GID, action: 'CLEAR' },
          },
          error: new Error('network down'),
        },
      ]
    );

    await expect(result.current?.clearFixes(BOOK_GID)).resolves.toBe(false);
    await waitFor(() => expect(result.current?.error).toBe('network down'));
  });

  // ACCEPT/UNDO rewrite the EPUB and change the fields the grid sorts and
  // filters on, so both move a book's position in `Library.entries` — a
  // move the mutation payload cannot express. DISMISS/CLEAR below prove the
  // OTHER half: they touch only the pending-fix row, already reconciled by
  // the payload's own `library { pendingFixes }` selection, so they must
  // NOT evict anything.
  it('evicts the LibraryEntries connection on ACCEPT', async () => {
    const { result, client } = renderHookWithApollo(() => useFixActions(), [acceptAllMock]);
    act(() => seedLibraryEntries(client));
    expect(readEntries(client)).not.toBeNull();

    await expect(result.current?.acceptFixes(BOOK_GID)).resolves.toBe(true);

    expect(readEntries(client)).toBeNull();
  });

  it('evicts the LibraryEntries connection on UNDO', async () => {
    const { result, client } = renderHookWithApollo(() => useFixActions(), [undoMock]);
    act(() => seedLibraryEntries(client));
    expect(readEntries(client)).not.toBeNull();

    await expect(result.current?.undoFixes(BOOK_GID)).resolves.toBe(true);

    expect(readEntries(client)).toBeNull();
  });

  it('leaves the LibraryEntries connection alone on DISMISS', async () => {
    const { result, client } = renderHookWithApollo(() => useFixActions(), [dismissAllMock]);
    act(() => seedLibraryEntries(client));
    expect(readEntries(client)).not.toBeNull();

    await expect(result.current?.dismissFixes(BOOK_GID)).resolves.toBe(true);

    expect(readEntries(client)).not.toBeNull();
  });

  it('leaves the LibraryEntries connection alone on CLEAR', async () => {
    const { result, client } = renderHookWithApollo(() => useFixActions(), [clearMock]);
    act(() => seedLibraryEntries(client));
    expect(readEntries(client)).not.toBeNull();

    await expect(result.current?.clearFixes(BOOK_GID)).resolves.toBe(true);

    expect(readEntries(client)).not.toBeNull();
  });

  // A typed error member (no `library` payload to evict from) must not
  // crash `update` — it should just no-op.
  it('does not evict on a failed ACCEPT (typed error, no payload)', async () => {
    const { result, client } = renderHookWithApollo(() => useFixActions(), [acceptCollisionMock]);
    act(() => seedLibraryEntries(client));
    expect(readEntries(client)).not.toBeNull();

    await expect(result.current?.acceptFixes(BOOK_GID)).resolves.toBe(false);

    expect(readEntries(client)).not.toBeNull();
  });
});

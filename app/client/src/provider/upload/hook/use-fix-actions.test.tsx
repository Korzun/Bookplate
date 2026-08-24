import type { MockedResponse } from '@apollo/client/testing';
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type {
  BookResolvePendingFixMutation,
  BookResolvePendingFixMutationVariables,
} from '~/gql/graphql';
import { BookResolvePendingFixDocument } from '~/graphql/upload';
import { renderHookWithApollo } from '~/test-utils';

import { useFixActions } from './use-fix-actions';

const BOOK_GID = 'BOOK-1';
const LIBRARY_ID = 'LIB-1';

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
});

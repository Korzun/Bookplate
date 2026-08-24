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

// Declared WITHOUT a `fixes` key at all — `MockedResponse` matches on
// variables, so this only matches a request that genuinely omits the key,
// not one that sends `fixes: undefined`.
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

  // The point of this test: `acceptAllMock` above declares NO `fixes` key.
  // If the hook passed `fixes: undefined` explicitly instead of omitting
  // the key, MockLink's variable match would fail and this would reject
  // with "No more mocked responses" instead of resolving `true`.
  it('omits `fixes` from the variables entirely for a bulk action', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [acceptAllMock]);

    await expect(result.current?.acceptFixes(BOOK_GID)).resolves.toBe(true);
  });

  it('dismisses every proposal when no fixes are named, omitting `fixes`', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [dismissAllMock]);

    await expect(result.current?.dismissFixes(BOOK_GID)).resolves.toBe(true);
  });

  it('undoes without ever passing `fixes`', async () => {
    const { result } = renderHookWithApollo(() => useFixActions(), [undoMock]);

    await expect(result.current?.undoFixes(BOOK_GID)).resolves.toBe(true);
  });

  it('clears without ever passing `fixes`', async () => {
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

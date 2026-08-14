import type { NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BookClearEditionsMutation, BookClearEditionsMutationVariables } from '~/gql/graphql';
import { BookClearEditionsDocument, BookDetailDocument } from '~/graphql/book';
import { renderHookWithApollo } from '~/test-utils';

import { useClearBookEditions } from './use-clear-book-editions';

const LIBRARY_ID = 'TGlicmFyeTox';
const BOOK_ID = 'book-1';

const clearEditionsMock = (
  clearedCount: number,
  deviceEditionCount: number
): MockedResponse<BookClearEditionsMutation, BookClearEditionsMutationVariables> => ({
  request: { query: BookClearEditionsDocument, variables: { id: BOOK_ID } },
  result: {
    data: {
      __typename: 'Mutation',
      bookClearEditions: {
        __typename: 'BookClearEditionsPayload',
        clearedCount,
        book: { __typename: 'Book', id: BOOK_ID, deviceEditionCount },
      },
    },
  },
});

// Seeds a full pre-clear `Book:<id>` entity (via the same document
// `useBookDetail` reads) at a non-zero `deviceEditionCount`, so the
// zeroed-count assertion actually proves an update happened rather than
// vacuously reading a freshly-created field.
const seedBook = (
  client: ReturnType<typeof renderHookWithApollo>['client'],
  deviceEditionCount: number
) =>
  client.writeQuery({
    query: BookDetailDocument,
    variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID },
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        book: {
          __typename: 'Book',
          id: BOOK_ID,
          title: 'Dune',
          author: 'Herbert',
          description: '',
          publisher: '',
          publishDate: '',
          addedAt: '2026-01-01T00:00:00.000Z',
          mtime: '2026-01-01T00:00:00.000Z',
          size: 0,
          pageCount: 0,
          chapterCount: 0,
          chapterNames: null,
          chapterSpineMap: [],
          subjects: [],
          seriesIndex: 0,
          hasCover: false,
          coverUrl: '',
          deviceEditionCount,
          series: null,
          progress: null,
          validation: null,
          lineage: [],
          pendingFix: null,
        },
      },
    },
  });

describe('useClearBookEditions', () => {
  it('returns a clearBookEditions function and initial false/undefined state', () => {
    const { result } = renderHookWithApollo(() => useClearBookEditions(), []);
    const [clearBookEditions, loading, error, errorMessage] = result.current!;
    expect(typeof clearBookEditions).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  // No hand-written `update` function exists for this hook: the payload
  // re-selects `book { id deviceEditionCount }`, so Apollo's own
  // normalization writes the new count onto the existing `Book` entity.
  // This test is the proof, per Global Constraints — asserted against the
  // CACHE, not just the resolved return value.
  it('zeroes deviceEditionCount in the cache with no hand-written update', async () => {
    const { result, client } = renderHookWithApollo(
      () => useClearBookEditions(),
      [clearEditionsMock(2, 0)]
    );
    act(() => seedBook(client, 2));

    await act(() => result.current![0](BOOK_ID));

    const extracted = client.cache.extract() as NormalizedCacheObject;
    const entity = extracted[`Book:${BOOK_ID}`] as { deviceEditionCount: number };
    expect(entity.deviceEditionCount).toBe(0);
  });

  it('returns the cleared count on success', async () => {
    const { result } = renderHookWithApollo(
      () => useClearBookEditions(),
      [clearEditionsMock(3, 0)]
    );

    let returned: number | undefined;
    await act(async () => {
      returned = await result.current![0](BOOK_ID);
    });

    expect(returned).toBe(3);
    expect(result.current![2]).toBe(false);
  });

  it('sets error and returns undefined when the mutation resolves missing (book not found for this owner)', async () => {
    const { result } = renderHookWithApollo(
      () => useClearBookEditions(),
      [
        {
          request: { query: BookClearEditionsDocument, variables: { id: BOOK_ID } },
          result: { data: { __typename: 'Mutation' as const, bookClearEditions: null } },
        },
      ]
    );

    let returned: number | undefined = 999;
    await act(async () => {
      returned = await result.current![0](BOOK_ID);
    });

    expect(returned).toBeUndefined();
    expect(result.current![2]).toBe(true);
    expect(result.current![3]).toBe('Failed to clear device editions');
  });

  it('sets error and errorMessage when the mutation throws', async () => {
    const { result } = renderHookWithApollo(
      () => useClearBookEditions(),
      [
        {
          request: { query: BookClearEditionsDocument, variables: { id: BOOK_ID } },
          error: new Error('Network error'),
        },
      ]
    );

    let returned: number | undefined = 999;
    await act(async () => {
      returned = await result.current![0](BOOK_ID);
    });

    expect(returned).toBeUndefined();
    expect(result.current![2]).toBe(true);
    expect(result.current![3]).toBe('Network error');
  });

  it('does not send a second request while the first is still in flight', async () => {
    const { result } = renderHookWithApollo(
      () => useClearBookEditions(),
      [{ ...clearEditionsMock(3, 0), delay: 20 }]
    );

    act(() => {
      void result.current![0](BOOK_ID);
    });
    await waitFor(() => expect(result.current![1]).toBe(true));

    let secondReturn: number | undefined = 999;
    await act(async () => {
      secondReturn = await result.current![0](BOOK_ID);
    });
    expect(secondReturn).toBeUndefined();
  });

  it('sets loading true during the request and resets it after', async () => {
    const { result } = renderHookWithApollo(
      () => useClearBookEditions(),
      [{ ...clearEditionsMock(3, 0), delay: 20 }]
    );

    act(() => {
      void result.current![0](BOOK_ID);
    });
    expect(result.current![1]).toBe(true);

    await waitFor(() => expect(result.current![1]).toBe(false));
  });
});

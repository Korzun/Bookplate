import type { NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type {
  BookDeleteMutation,
  BookDeleteMutationVariables,
  LibraryEntriesQuery,
} from '~/gql/graphql';
import { BookDeleteDocument } from '~/graphql/book';
import { LibraryEntriesDocument } from '~/graphql/library';
import { renderHookWithApollo } from '~/test-utils';

import { useDeleteBook } from './use-delete-book';

const LIBRARY_ID = 'lib-1';
const BOOK_ID = 'book-1';
const libraryEntriesVariables = { libraryId: LIBRARY_ID, first: 20, filter: undefined };

type LibraryEntryNode = Extract<
  NonNullable<LibraryEntriesQuery['node']>,
  { __typename: 'Library' }
>['entries']['edges'][number]['node'];

const standaloneBook = {
  __typename: 'Book' as const,
  id: BOOK_ID,
  title: 'Dune',
  author: 'Herbert',
  seriesIndex: 0,
  hasCover: false,
  thumbnailUrl: '',
  progress: null,
};

const otherBook = {
  __typename: 'Book' as const,
  id: 'book-2',
  title: 'Other',
  author: 'B',
  seriesIndex: 0,
  hasCover: false,
  thumbnailUrl: '',
  progress: null,
};

// The server deletes a series when its last book goes with it
// (`book-store.ts`'s `deleteBook`), but `BookDeletePayload` carries no
// `deletedSeriesId` — the client has nothing to `cache.evict` for the
// `Series` entity itself. This row-in-a-series shape is what forces the
// hand-written `update` to invalidate the WHOLE `Library.entries` connection
// rather than only evicting the deleted `Book`.
const soloSeries = {
  __typename: 'Series' as const,
  id: 'series-1',
  name: 'Solo Series',
  author: 'A',
  bookCount: 1,
  progressPercentage: 0,
  books: {
    __typename: 'BookConnection' as const,
    edges: [
      {
        __typename: 'BookEdge' as const,
        node: {
          __typename: 'Book' as const,
          id: 'book-only',
          title: 'Only Book',
          hasCover: false,
          mtime: '',
          thumbnailUrl: '',
        },
      },
    ],
  },
};

const deleteSuccessMock = (
  id: string
): MockedResponse<BookDeleteMutation, BookDeleteMutationVariables> => ({
  request: { query: BookDeleteDocument, variables: { id } },
  result: {
    data: {
      __typename: 'Mutation',
      bookDelete: {
        __typename: 'BookDeletePayload',
        deletedId: id,
        library: { __typename: 'Library', id: LIBRARY_ID },
      },
    },
  },
});

const seedLibraryEntries = (
  client: ReturnType<typeof renderHookWithApollo>['client'],
  edges: { cursor: string; node: LibraryEntryNode }[]
) =>
  client.writeQuery({
    query: LibraryEntriesDocument,
    variables: libraryEntriesVariables,
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        entries: {
          __typename: 'LibraryEntriesConnection',
          edges: edges.map((e) => ({ __typename: 'LibraryEntriesConnectionEdge' as const, ...e })),
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
  });

describe('useDeleteBook', () => {
  it('returns a deleteBook function and initial false/undefined state', () => {
    const { result } = renderHookWithApollo(() => useDeleteBook(), []);
    const [deleteBook, loading, error, errorMessage] = result.current!;
    expect(typeof deleteBook).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('evicts the deleted book from the cache', async () => {
    const { result, client } = renderHookWithApollo(
      () => useDeleteBook(),
      [deleteSuccessMock(BOOK_ID)]
    );
    act(() => seedLibraryEntries(client, [{ cursor: 'c1', node: standaloneBook }]));

    await act(() => result.current![0](BOOK_ID));

    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(Object.keys(extracted)).not.toContain(`Book:${BOOK_ID}`);
  });

  // A standalone book's OWN edge would in fact self-heal from `Book`
  // eviction alone (`InMemoryCache` drops a dangling `Reference` when a
  // connection is read — proven directly against the cache during this
  // hook's design; see its doc comment). This hook does not special-case
  // that: it invalidates the WHOLE `entries` field unconditionally, because
  // the payload gives it no way to tell "standalone" apart from "last book
  // in a series" (see the series test below for why the latter needs it).
  // Asserting `null` here — not "book-2 survives, book-1 doesn't" — is what
  // actually pins that unconditional behavior, rather than merely
  // rediscovering the self-healing case that never needed a hand-written
  // fix.
  it('invalidates the LibraryEntries connection so a subsequent read misses the cache (standalone book)', async () => {
    const { result, client } = renderHookWithApollo(
      () => useDeleteBook(),
      [deleteSuccessMock(BOOK_ID)]
    );
    act(() =>
      seedLibraryEntries(client, [
        { cursor: 'c1', node: standaloneBook },
        { cursor: 'c2', node: otherBook },
      ])
    );

    await act(() => result.current![0](BOOK_ID));

    const cached = client.cache.readQuery({
      query: LibraryEntriesDocument,
      variables: libraryEntriesVariables,
    });
    expect(cached).toBeNull();
  });

  it("removes an emptied series' row from a subsequent LibraryEntries cache read", async () => {
    const { result, client } = renderHookWithApollo(
      () => useDeleteBook(),
      [deleteSuccessMock('book-only')]
    );
    act(() => seedLibraryEntries(client, [{ cursor: 'c1', node: soloSeries }]));

    await act(() => result.current![0]('book-only'));

    // The stale Series row cannot simply "disappear" from a cache the client
    // never re-fetches — this asserts the connection was invalidated
    // (`readQuery` returns `null`, meaning the NEXT read is forced to hit
    // the network) rather than the impossible claim that the entity vanished
    // on its own.
    const cached = client.cache.readQuery({
      query: LibraryEntriesDocument,
      variables: libraryEntriesVariables,
    });
    expect(cached).toBeNull();
  });

  it('sets error and errorMessage when the mutation throws', async () => {
    const { result } = renderHookWithApollo(
      () => useDeleteBook(),
      [
        {
          request: { query: BookDeleteDocument, variables: { id: BOOK_ID } },
          error: new Error('Network error'),
        },
      ]
    );

    await act(() => result.current![0](BOOK_ID));

    expect(result.current![2]).toBe(true);
    expect(result.current![3]).toBe('Network error');
  });

  it('sets error when the mutation resolves missing (book not found for this owner)', async () => {
    const { result } = renderHookWithApollo(
      () => useDeleteBook(),
      [
        {
          request: { query: BookDeleteDocument, variables: { id: BOOK_ID } },
          result: { data: { __typename: 'Mutation' as const, bookDelete: null } },
        },
      ]
    );

    await act(() => result.current![0](BOOK_ID));

    expect(result.current![2]).toBe(true);
    expect(result.current![3]).toBe('Failed to delete book');
  });

  it('sets loading true during the request and resets it after', async () => {
    const { result } = renderHookWithApollo(
      () => useDeleteBook(),
      [{ ...deleteSuccessMock(BOOK_ID), delay: 20 }]
    );

    act(() => {
      void result.current![0](BOOK_ID);
    });
    expect(result.current![1]).toBe(true);

    await waitFor(() => expect(result.current![1]).toBe(false));
    expect(result.current![2]).toBe(false);
  });

  // The `if (loading) return;` guard in `use-delete-book.ts` is live code,
  // not leftover REST-era plumbing — it still needs its own coverage. Only
  // ONE mock is queued: if the guard were removed, the second call would
  // try to consume a SECOND response from a `MockLink` that has none left,
  // surfacing as an error instead of silently doing nothing.
  it('does not send a second request while the first is still in flight', async () => {
    const { result } = renderHookWithApollo(
      () => useDeleteBook(),
      [{ ...deleteSuccessMock(BOOK_ID), delay: 20 }]
    );

    act(() => {
      void result.current![0](BOOK_ID);
    });
    await waitFor(() => expect(result.current![1]).toBe(true));

    await act(() => result.current![0](BOOK_ID));
    expect(result.current![2]).toBe(false);
    expect(result.current![3]).toBeUndefined();

    await waitFor(() => expect(result.current![1]).toBe(false));
  });
});

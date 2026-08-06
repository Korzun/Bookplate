import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { LibraryFilter } from '~/gql/graphql';
import { LibraryEntriesDocument } from '~/graphql/library';
import { renderHookWithApollo } from '~/test-utils';

import { useLibraryEntries } from './use-library-entries';

const LIBRARY_ID = 'LIB-1';
const PAGE_SIZE = 20;

let currentLibraryId: string | undefined = LIBRARY_ID;

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: false }),
}));

const bookEdge = (cursor: string, overrides: Record<string, unknown>) => ({
  __typename: 'LibraryEntriesConnectionEdge' as const,
  cursor,
  node: {
    __typename: 'Book' as const,
    id: 'BOOK-1',
    title: 'Dune',
    author: 'Frank Herbert',
    seriesIndex: 0,
    hasCover: true,
    thumbnailUrl: '/thumb.jpg',
    progress: null,
    ...overrides,
  },
});

const connection = (
  edges: ReturnType<typeof bookEdge>[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  node: {
    __typename: 'Library' as const,
    id: LIBRARY_ID,
    entries: {
      __typename: 'LibraryEntriesConnection' as const,
      edges,
      pageInfo: { __typename: 'PageInfo' as const, ...pageInfo },
    },
  },
});

const firstPageMock = (
  edges: ReturnType<typeof bookEdge>[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
  filter: LibraryFilter | undefined = undefined
) => ({
  request: {
    query: LibraryEntriesDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, filter },
  },
  result: { data: { __typename: 'Query' as const, ...connection(edges, pageInfo) } },
});

const fetchMoreMock = (
  after: string,
  edges: ReturnType<typeof bookEdge>[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  request: {
    query: LibraryEntriesDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, after, filter: undefined },
  },
  result: { data: { __typename: 'Query' as const, ...connection(edges, pageInfo) } },
});

const fetchMoreErrorMock = (after: string) => ({
  request: {
    query: LibraryEntriesDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, after, filter: undefined },
  },
  error: new Error('fetch more failed'),
});

/**
 * Wraps `useLibraryEntries` with local filter state so a single render
 * across `renderHookWithApollo` can change the filter argument later via
 * `setFilter`, exactly like a real caller re-rendering with a new prop.
 */
const useProbe = (initialFilter: LibraryFilter | undefined) => {
  const [filter, setFilter] = useState(initialFilter);
  return { ...useLibraryEntries(filter), setFilter };
};

const renderProbe = (
  mocks: MockedResponse[],
  initialFilter: LibraryFilter | undefined = undefined
) => renderHookWithApollo(() => useProbe(initialFilter), mocks).result;

describe('useLibraryEntries', () => {
  it('returns edges for the current library', async () => {
    const result = renderProbe([
      firstPageMock([bookEdge('c1', { id: 'BOOK-1', title: 'Dune' })], {
        hasNextPage: false,
        endCursor: null,
      }),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.error).toBeUndefined();
    expect(result.current?.edges).toHaveLength(1);
    expect(result.current?.edges[0]?.node.__typename).toBe('Book');
    expect(result.current?.hasNextPage).toBe(false);
  });

  it('appends the next page on fetchNextPage without dropping the first', async () => {
    const result = renderProbe([
      firstPageMock([bookEdge('c1', { id: 'BOOK-1', title: 'Dune' })], {
        hasNextPage: true,
        endCursor: 'c1',
      }),
      fetchMoreMock('c1', [bookEdge('c2', { id: 'BOOK-2', title: 'Dune Messiah' })], {
        hasNextPage: false,
        endCursor: 'c2',
      }),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.edges).toHaveLength(1);
    expect(result.current?.hasNextPage).toBe(true);

    await act(async () => {
      await result.current?.fetchNextPage();
    });

    await waitFor(() => expect(result.current?.edges).toHaveLength(2));
    expect(result.current?.edges.map((e) => e.node.id)).toEqual(['BOOK-1', 'BOOK-2']);
    expect(result.current?.hasNextPage).toBe(false);
    expect(result.current?.error).toBeUndefined();
  });

  it('keeps existing edges when fetchNextPage fails', async () => {
    const result = renderProbe([
      firstPageMock([bookEdge('c1', { id: 'BOOK-1', title: 'Dune' })], {
        hasNextPage: true,
        endCursor: 'c1',
      }),
      fetchMoreErrorMock('c1'),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.edges).toHaveLength(1);

    await act(async () => {
      await result.current?.fetchNextPage();
    });

    await waitFor(() => expect(result.current?.error).toBe('fetch more failed'));
    expect(result.current?.edges).toHaveLength(1);
    expect(result.current?.edges[0]?.node.id).toBe('BOOK-1');
    expect(result.current?.hasNextPage).toBe(true);
  });

  it('does not query when there is no library id', () => {
    currentLibraryId = undefined;
    try {
      // No mocks at all: if the hook fired LibraryEntries anyway, MockLink
      // would throw "No more mocked responses" and fail this test loudly
      // rather than let it pass vacuously.
      const result = renderProbe([]);

      expect(result.current?.loading).toBe(false);
      expect(result.current?.edges).toEqual([]);
      expect(result.current?.error).toBeUndefined();
    } finally {
      currentLibraryId = LIBRARY_ID;
    }
  });

  it('starts a fresh list when the filter changes', async () => {
    const filterA: LibraryFilter = { author: 'Herbert' };
    const filterB: LibraryFilter = { author: 'Tolkien' };

    const result = renderProbe(
      [
        firstPageMock(
          [bookEdge('c1', { id: 'BOOK-1', title: 'Dune' })],
          { hasNextPage: false, endCursor: null },
          filterA
        ),
        firstPageMock(
          [bookEdge('c2', { id: 'BOOK-2', title: 'The Hobbit' })],
          { hasNextPage: false, endCursor: null },
          filterB
        ),
      ],
      filterA
    );

    await waitFor(() => expect(result.current?.edges).toHaveLength(1));
    expect(result.current?.edges[0]?.node.id).toBe('BOOK-1');

    await act(async () => {
      result.current?.setFilter(filterB);
    });

    await waitFor(() => expect(result.current?.edges[0]?.node.id).toBe('BOOK-2'));
    expect(result.current?.edges).toHaveLength(1);
  });
});

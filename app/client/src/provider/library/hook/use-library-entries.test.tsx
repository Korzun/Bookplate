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
let currentLibraryIdLoading = false;

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: currentLibraryIdLoading }),
}));

/**
 * `edges` is a MASKED array (see `use-library-entries.ts`'s doc comment):
 * `node`'s fragment fields (`id`, `title`, ...) are not visible on the
 * hook's return type without a `useFragment` call this hook deliberately
 * does not make. Everything these tests assert on — `cursor` and
 * `node.__typename` — is a plain sibling selection, NOT part of either
 * named fragment, so it stays visible pre-unmask and is enough to prove
 * order, count, and Book/Series discrimination without reaching into
 * fragment-only fields.
 */
const bookEdge = (cursor: string, overrides: Record<string, unknown> = {}) => ({
  __typename: 'LibraryEntriesConnectionEdge' as const,
  cursor,
  node: {
    __typename: 'Book' as const,
    id: `BOOK-${cursor}`,
    title: 'Dune',
    author: 'Frank Herbert',
    seriesIndex: 0,
    hasCover: true,
    thumbnailUrl: '/thumb.jpg',
    progress: null,
    ...overrides,
  },
});

const seriesEdge = (cursor: string, overrides: Record<string, unknown> = {}) => ({
  __typename: 'LibraryEntriesConnectionEdge' as const,
  cursor,
  node: {
    __typename: 'Series' as const,
    id: `SERIES-${cursor}`,
    name: 'Dune Chronicles',
    author: 'Frank Herbert',
    bookCount: 6,
    ...overrides,
  },
});

const connection = (
  edges: (ReturnType<typeof bookEdge> | ReturnType<typeof seriesEdge>)[],
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
  edges: (ReturnType<typeof bookEdge> | ReturnType<typeof seriesEdge>)[],
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
  edges: (ReturnType<typeof bookEdge> | ReturnType<typeof seriesEdge>)[],
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
      firstPageMock([bookEdge('c1')], { hasNextPage: false, endCursor: null }),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.error).toBeUndefined();
    expect(result.current?.edges).toHaveLength(1);
    expect(result.current?.edges[0]?.node.__typename).toBe('Book');
    expect(result.current?.hasNextPage).toBe(false);
  });

  it('appends the next page on loadMore without dropping the first', async () => {
    const result = renderProbe([
      firstPageMock([bookEdge('c1')], { hasNextPage: true, endCursor: 'c1' }),
      fetchMoreMock('c1', [bookEdge('c2')], { hasNextPage: false, endCursor: 'c2' }),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.edges).toHaveLength(1);
    expect(result.current?.hasNextPage).toBe(true);

    act(() => result.current?.loadMore());

    await waitFor(() => expect(result.current?.edges).toHaveLength(2));
    expect(result.current?.edges.map((e) => e.cursor)).toEqual(['c1', 'c2']);
    expect(result.current?.hasNextPage).toBe(false);
    expect(result.current?.error).toBeUndefined();
    expect(result.current?.loadingMore).toBe(false);
  });

  it('keeps existing edges when loadMore fails, and offers a retry via error', async () => {
    const result = renderProbe([
      firstPageMock([bookEdge('c1')], { hasNextPage: true, endCursor: 'c1' }),
      fetchMoreErrorMock('c1'),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.edges).toHaveLength(1);

    act(() => result.current?.loadMore());

    await waitFor(() => expect(result.current?.error).toBe('fetch more failed'));
    expect(result.current?.edges).toHaveLength(1);
    expect(result.current?.edges[0]?.cursor).toBe('c1');
    expect(result.current?.hasNextPage).toBe(true);
    expect(result.current?.loadingMore).toBe(false);
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

  // Review round 1 (cold-load empty-state flash, blocked merge): a SKIPPED
  // `useQuery` reports `loading: false`, and `libraryId` is `undefined` for
  // the whole `ViewerBootstrap` round trip on a cold load — including for an
  // admin with a stored selection, since `useCurrentLibraryId` only trusts
  // that selection once it has learned `isAdmin` from that same query. A
  // consumer keying its empty-state spinner off `loading` alone (exactly
  // what `LibraryPage` does) would render "library is empty" for that whole
  // window without this.
  it('reports loading while useCurrentLibraryId itself is still resolving, even though the query is skipped', () => {
    currentLibraryId = undefined;
    currentLibraryIdLoading = true;
    try {
      const result = renderProbe([]);

      expect(result.current?.loading).toBe(true);
      expect(result.current?.edges).toEqual([]);
    } finally {
      currentLibraryId = LIBRARY_ID;
      currentLibraryIdLoading = false;
    }
  });

  it('starts a fresh list when the filter changes', async () => {
    const filterA: LibraryFilter = { author: 'Herbert' };
    const filterB: LibraryFilter = { author: 'Tolkien' };

    const result = renderProbe(
      [
        firstPageMock([bookEdge('c1')], { hasNextPage: false, endCursor: null }, filterA),
        firstPageMock([bookEdge('c2')], { hasNextPage: false, endCursor: null }, filterB),
      ],
      filterA
    );

    await waitFor(() => expect(result.current?.edges).toHaveLength(1));
    expect(result.current?.edges[0]?.cursor).toBe('c1');

    await act(async () => {
      result.current?.setFilter(filterB);
    });

    await waitFor(() => expect(result.current?.edges[0]?.cursor).toBe('c2'));
    expect(result.current?.edges).toHaveLength(1);
  });

  it('preserves Book/Series discrimination and edge order across an interleaved page', async () => {
    const result = renderProbe([
      firstPageMock([seriesEdge('c1'), bookEdge('c2'), bookEdge('c3'), seriesEdge('c4')], {
        hasNextPage: false,
        endCursor: null,
      }),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.edges.map((e) => e.cursor)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(result.current?.edges.map((e) => e.node.__typename)).toEqual([
      'Series',
      'Book',
      'Book',
      'Series',
    ]);
  });
});

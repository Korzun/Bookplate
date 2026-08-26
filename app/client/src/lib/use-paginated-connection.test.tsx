import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { LibraryEntriesQuery } from '~/gql/graphql';
import { LibraryEntriesDocument } from '~/graphql/library';
import { renderHookWithApollo } from '~/test-utils';

import { usePaginatedConnection } from './use-paginated-connection';

/**
 * `LibraryEntriesDocument` is reused as this generic helper's test fixture
 * rather than a bespoke document: it already has the exact shape every real
 * call site needs (a `node(id:)`-rooted connection with `edges`/`pageInfo`
 * and a nullable `after`), and codegen excludes `*.test.{ts,tsx}` from its
 * `documents` glob (`codegen.ts`'s own doc comment), so reusing it here adds
 * no new document for codegen/cost-budget tooling to pick up.
 *
 * Mocks below are deliberately UNANNOTATED object literals, matching every
 * other `LibraryEntriesDocument` mock in this codebase
 * (`use-library-entries.test.tsx`'s own `bookEdge`/`firstPageMock`) rather
 * than `MockedResponse<LibraryEntriesQuery>` — see `test-utils.tsx`'s
 * `renderWithApollo` doc comment for why: an explicit annotation here would
 * enforce fragment MASKING on the `Book` node's fields (they'd need to be
 * wrapped in `$fragmentRefs` instead of the plain fields asserted on
 * below), which is exactly what `LibraryEntryEdge`'s own doc comment says
 * this connection deliberately does NOT unmask.
 */
const LIBRARY_ID = 'LIB-1';
const PAGE_SIZE = 20;

const bookEdge = (cursor: string) => ({
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
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
) => ({
  request: {
    query: LibraryEntriesDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, filter: undefined },
  },
  result: { data: { __typename: 'Query' as const, ...connection(edges, pageInfo) } },
});

const firstPageErrorMock = () => ({
  request: {
    query: LibraryEntriesDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, filter: undefined },
  },
  error: new Error('boom'),
});

const fetchMoreMock = (
  after: string,
  edges: ReturnType<typeof bookEdge>[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
  delay = 0
) => ({
  request: {
    query: LibraryEntriesDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, after, filter: undefined },
  },
  result: { data: { __typename: 'Query' as const, ...connection(edges, pageInfo) } },
  delay,
});

const fetchMoreErrorMock = (after: string) => ({
  request: {
    query: LibraryEntriesDocument,
    variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, after, filter: undefined },
  },
  error: new Error('boom'),
});

const select = (data: LibraryEntriesQuery | undefined) =>
  data?.node?.__typename === 'Library' ? data.node.entries : undefined;

const renderProbe = (mocks: MockedResponse[], resetKey = 'k1') =>
  renderHookWithApollo(
    () =>
      usePaginatedConnection({
        document: LibraryEntriesDocument,
        variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, filter: undefined },
        select,
        resetKey,
        loadMoreErrorMessage: 'Failed to load more',
      }),
    mocks
  ).result;

/**
 * Wraps the helper with local `resetKey` state so a single render can
 * change it later, exactly like `useLibraryEntries.test.tsx`'s own
 * `useProbe` changes `filter`.
 */
const useResetKeyProbe = (initialResetKey: string) => {
  const [resetKey, setResetKey] = useState(initialResetKey);
  return {
    ...usePaginatedConnection({
      document: LibraryEntriesDocument,
      variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, filter: undefined },
      select,
      resetKey,
      loadMoreErrorMessage: 'Failed to load more',
    }),
    setResetKey,
  };
};

describe('usePaginatedConnection', () => {
  it('returns edges, hasNextPage, and no error on a successful first page', async () => {
    const result = renderProbe([
      firstPageMock([bookEdge('c1')], { hasNextPage: true, endCursor: 'c1' }),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.edges).toHaveLength(1);
    expect(result.current?.hasNextPage).toBe(true);
    expect(result.current?.error).toBeUndefined();
  });

  // The regression guard for constraint (a): with `notifyOnNetworkStatusChange:
  // true` required to derive `loadingMore` at all, Apollo's own raw `loading`
  // goes true during `fetchMore` too. If `loading` here were ever wired to
  // that raw value instead of `networkStatus`, this assertion catches it —
  // `loading` MUST stay false throughout the second page's flight.
  it('reports loadingMore, not loading, during a fetchMore', async () => {
    // `delay: 100` gives the intermediate `networkStatus: fetchMore` state a
    // real window to be observed. `waitFor`'s default poll interval is 50ms
    // (`@testing-library/dom`) — an undelayed (or lightly delayed) mock can
    // resolve, and flip `networkStatus` back to `ready`, entirely BETWEEN
    // two polls, so a naive assertion races past the transient state and
    // passes for the wrong reason (or flakes) instead of ever observing it.
    // 100ms comfortably spans at least one full poll interval.
    const result = renderProbe([
      firstPageMock([bookEdge('c1')], { hasNextPage: true, endCursor: 'c1' }),
      fetchMoreMock('c1', [bookEdge('c2')], { hasNextPage: false, endCursor: 'c2' }, 100),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.edges).toHaveLength(1);
    expect(result.current?.loadingMore).toBe(false);

    act(() => result.current?.loadMore());

    await waitFor(() => expect(result.current?.loadingMore).toBe(true));
    expect(result.current?.loading).toBe(false);

    await waitFor(() => expect(result.current?.loadingMore).toBe(false));
    expect(result.current?.loading).toBe(false);
    expect(result.current?.edges).toHaveLength(2);
  });

  // Constraints (b)/(c): a fetchMore rejection is not threaded into
  // useQuery's `error` by Apollo itself — the helper must catch it and
  // surface it through the same `error` field, without touching `edges`.
  it('keeps existing edges when fetchMore rejects, and surfaces the error', async () => {
    const result = renderProbe([
      firstPageMock([bookEdge('c1')], { hasNextPage: true, endCursor: 'c1' }),
      fetchMoreErrorMock('c1'),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.edges).toHaveLength(1);

    act(() => result.current?.loadMore());

    await waitFor(() => expect(result.current?.error).toBe('boom'));
    expect(result.current?.edges).toHaveLength(1);
    expect(result.current?.edges[0]?.cursor).toBe('c1');
    expect(result.current?.hasNextPage).toBe(true);
    expect(result.current?.loadingMore).toBe(false);
  });

  it('reports the first-page error with empty edges', async () => {
    const result = renderProbe([firstPageErrorMock()]);

    await waitFor(() => expect(result.current?.error).toBe('boom'));
    expect(result.current?.edges).toEqual([]);
    expect(result.current?.loading).toBe(false);
  });

  it('clears a stale fetchMore error when resetKey changes', async () => {
    const result = renderHookWithApollo(
      () => useResetKeyProbe('k1'),
      [
        firstPageMock([bookEdge('c1')], { hasNextPage: true, endCursor: 'c1' }),
        fetchMoreErrorMock('c1'),
      ]
    ).result;

    await waitFor(() => expect(result.current?.loading).toBe(false));

    act(() => result.current?.loadMore());
    await waitFor(() => expect(result.current?.error).toBe('boom'));

    act(() => result.current?.setResetKey('k2'));

    await waitFor(() => expect(result.current?.error).toBeUndefined());
    // The list identity changed, but Apollo's own cached edges for this
    // exact document/variables pair are untouched — only the STALE
    // fetchMore error clears, not the rows themselves.
    expect(result.current?.edges).toHaveLength(1);
  });
});

import { ApolloClient, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { MockLink, type MockedResponse } from '@apollo/client/testing';
import { act, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { LibraryEntriesQuery } from '~/gql/graphql';
import { LibraryEntriesDocument } from '~/page/library';
import { cacheConfig } from '~/provider/apollo';
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
 * other pre-existing `LibraryEntriesDocument` fixture in this codebase
 * (`page/library`'s own `bookEdge`/`firstPageMock`, prior to that route
 * test moving onto explicit `MockedResponse<LibraryEntriesQuery>`
 * annotations — task 5) rather than `MockedResponse<LibraryEntriesQuery>`
 * — see `test-utils.tsx`'s `renderWithApollo` doc comment for why: an
 * explicit annotation here would enforce fragment MASKING on the `Book`
 * node's fields (they'd need to be wrapped in `$fragmentRefs` instead of
 * the plain fields asserted on below), which is exactly what
 * `page/library/index.tsx`'s `LibraryEntryEdge` doc comment says this
 * connection deliberately does NOT unmask.
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
 * change it later, exactly like `page/library`'s own filter-changing probe
 * pattern.
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

  // Task 3 review round 1, Item 7: neither of `loadMore`'s two early-return
  // guards had a covering test. This one is the `!hasNextPage` guard — only
  // ONE mock is queued (the first page, with `hasNextPage: false`); if the
  // guard were removed, `loadMore()` would call `fetchMore` anyway, and
  // `MockLink` — with no second mock left to serve — would reject, which
  // this hook catches and surfaces via `error`.
  it('loadMore does nothing when there is no next page', async () => {
    const result = renderProbe([
      firstPageMock([bookEdge('c1')], { hasNextPage: false, endCursor: null }),
    ]);

    await waitFor(() => expect(result.current?.loading).toBe(false));

    act(() => result.current?.loadMore());

    // Nothing to `waitFor` toward (a no-op produces no state transition) —
    // asserted immediately AND after a beat, so a delayed/async guard
    // failure would still be caught.
    expect(result.current?.error).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current?.error).toBeUndefined();
    expect(result.current?.edges).toHaveLength(1);
    expect(result.current?.loadingMore).toBe(false);
  });

  // Task 3 review round 1, Item 7: the `loadingMore` RE-ENTRANCY guard —
  // NEW in this task (none of the four hand-rolls this helper replaced had
  // one at all on `use-library-entries`, and `page/library`'s own
  // `IntersectionObserver` effect depends on it: `loadMore`'s identity
  // changes when `loadingMore` flips, so a second intersection firing
  // before the first page resolves must be a no-op, not a second request).
  //
  // `queryDeduplication: false` is DELIBERATE and load-bearing here: Apollo
  // Client defaults it to `true`, and its own `inFlightLinkObservables`
  // mechanism reuses a single in-flight link request for two calls issued
  // with IDENTICAL query+variables (which two rapid `loadMore()` calls
  // always are — `after` doesn't change until the first page resolves).
  // With the default left on, a version of this test built on
  // `renderProbe`/`renderHookWithApollo` (a single queued mock, both
  // `loadMore()` calls, then asserting no error and 2 edges) PASSES
  // identically whether or not `loadMore`'s own `loadingMore` guard exists
  // at all — Apollo's own dedup silently absorbs the second call before it
  // ever reaches `MockLink`, so that version of the test could not have
  // caught its own regression. Disabling dedup on a purpose-built client
  // here forces the SECOND call to actually reach the link if the guard is
  // missing, isolating this helper's own guard from Apollo's.
  it('does not fire a second fetchMore while one is already in flight', async () => {
    const mocks = [
      firstPageMock([bookEdge('c1')], { hasNextPage: true, endCursor: 'c1' }),
      fetchMoreMock('c1', [bookEdge('c2')], { hasNextPage: false, endCursor: 'c2' }, 400),
    ];
    const client = new ApolloClient({
      link: new MockLink(mocks),
      cache: new InMemoryCache(cacheConfig),
      queryDeduplication: false,
    });
    const result: { current: ReturnType<typeof usePaginatedConnection> | undefined } = {
      current: undefined,
    };
    function Probe() {
      result.current = usePaginatedConnection({
        document: LibraryEntriesDocument,
        variables: { libraryId: LIBRARY_ID, first: PAGE_SIZE, filter: undefined },
        select,
        resetKey: 'k1',
        loadMoreErrorMessage: 'Failed to load more',
      });
      return null;
    }
    render(
      <ApolloProvider client={client}>
        <Probe />
      </ApolloProvider>
    );

    await waitFor(() => expect(result.current?.loading).toBe(false));

    act(() => result.current?.loadMore());
    await waitFor(() => expect(result.current?.loadingMore).toBe(true));

    // Only ONE mock was queued for the fetchMore request; with
    // `queryDeduplication: false` above, if the guard were removed this
    // second call WOULD reach `MockLink` looking for a second (missing)
    // match, which rejects near-instantly — well before the FIRST call's
    // 400ms delay elapses. Checking only the FINAL state (after both
    // settle) cannot tell the two scenarios apart: an unguarded second call
    // fails fast, but the first call's later, legitimate success still
    // calls `setFetchMoreError(undefined)` and overwrites that failure
    // before this test would ever observe it — an end state
    // indistinguishable from the guard working correctly. So this samples
    // `error` repeatedly through the gap BEFORE the first call settles
    // (well under its 400ms delay) and records whether MockLink's
    // "no more mocked responses" rejection ever appeared, rather than only
    // checking the state after everything has settled.
    act(() => result.current?.loadMore());

    let sawUnguardedSecondRequest = false;
    for (let i = 0; i < 15; i++) {
      // eslint-disable-next-line no-await-in-loop -- deliberate: sampling a transient state over time, not parallelizable
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (result.current?.error?.includes('No more mocked responses')) {
        sawUnguardedSecondRequest = true;
        break;
      }
    }
    expect(sawUnguardedSecondRequest).toBe(false);

    await waitFor(() => expect(result.current?.loadingMore).toBe(false));
    expect(result.current?.error).toBeUndefined();
    expect(result.current?.edges).toHaveLength(2);
  });
});

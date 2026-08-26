import { useQuery } from '@apollo/client/react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';

import { BookRowFromEntry, Page, SearchBar, SeriesRow } from '~/component';
import { LibrarySwitcher } from '~/component/library-switcher';
import { graphql } from '~/gql';
import type { LibraryEntriesQuery } from '~/gql/graphql';
import { UserListDocument } from '~/graphql/user';
import { SpinnerIcon } from '~/icon';
import { useBookListFilter } from '~/lib/use-book-list-filter';
import { usePaginatedConnection } from '~/lib/use-paginated-connection';
import { useIsAdmin } from '~/provider/auth';
import { useCurrentLibraryId, useLibraryTarget } from '~/provider/library-target';
import { path } from '~/router';

import { useStyle } from './style';
import { toLibraryFilter } from './to-library-filter';

/**
 * `LibraryEntries` is the most expensive document in this migration:
 * `Library.entries` is priced at `maxSize` (100) because `first` is a
 * variable, and every edge fans out into a `Book` or a `Series`.
 * `...BookRowFragment`/`...SeriesRowFragment` below are resolved by NAME
 * against `component/book-row/from-entry.tsx`'s and
 * `component/series-row/index.tsx`'s own `graphql(...)` definitions —
 * codegen matches fragments across files by name (its `documents` glob),
 * not via a JS import, so this document needs no import of either fragment
 * to compile.
 *
 * `SeriesRowFragment` DOES select `Series.books` — `books(first: 3)`, a
 * LITERAL page size, priced at 3 (`literalIntArg`/`pageSizeMultiplier` in
 * `cost-limit.ts`), not the 100 a variable `$first` would price at. Nesting
 * a ×3 connection inside the ×100 `entries` connection is what feeds
 * `CoverStack` its three cover books directly from this document instead of
 * a separate, REST-list-backed fetch — the REST list only ever holds page 1
 * (this page's grid grows via this document's own `fetchMore`, not the REST
 * list, so nothing keeps that list current past entry 20; see
 * `component/cover-stack`'s doc comment for the regression this replaces).
 * Measured BEFORE `books(first: 3)` was added: breadth 36 (36.0%),
 * complexity 2907 (8.8%) — the jump to the numbers below (+11 breadth,
 * +3100 complexity) is three books' worth of
 * `id`/`title`/`hasCover`/`mtime`/`thumbnailUrl`, scaled by `entries`' own
 * ×100, confirming the ×3-not-×100 nesting claim above rather than just
 * asserting it.
 *
 * `node(id: $libraryId) { id ... on Library { id ... } }` selects `id` at
 * BOTH levels deliberately: `node` resolves to the `Node` INTERFACE, which
 * declares its own `id`, and an inline `... on Library { id }` alone
 * satisfies `Library`'s cache key but not `Node`'s — the interface selection
 * needs its own `id` for Apollo's normalized cache to key the result
 * (`src/provider/apollo/selection-ids.test.ts` guards this).
 *
 * Measured (`test:cost -w app/server`): breadth 47 (47.0%), complexity 6007
 * (18.2%) of budget — comfortably under the 70% gate on both axes, UNCHANGED
 * from before task 5's colocation. Ruling E's "+1 breadth per fragment
 * spread site" applies when a document moves from an INLINE selection to a
 * named-fragment spread — this document already spread `...BookRowFragment`
 * `/...SeriesRowFragment` before task 5; only the two fragments' JS *source
 * file* moved (into `component/book-row/from-entry.tsx` and
 * `component/series-row/index.tsx`), not their usage in the printed query
 * document the cost walker actually measures, so neither axis moved.
 */
export const LibraryEntriesDocument = graphql(`
  query LibraryEntries($libraryId: ID!, $first: Int!, $after: String, $filter: LibraryFilter) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        entries(first: $first, after: $after, filter: $filter) {
          edges {
            cursor
            node {
              __typename
              ... on Book {
                ...BookRowFragment
              }
              ... on Series {
                ...SeriesRowFragment
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`);

/**
 * Matches `CONNECTION_LIMITS.libraryEntries.defaultSize` on the server
 * (`app/server/graphql/schema/pagination.ts`) — the size the server itself
 * falls back to when `first` is omitted. `$first` is non-null on
 * `LibraryEntriesDocument`, so this page must always supply a value; picking
 * the server's own default keeps the two in agreement without importing
 * across the client/server boundary.
 */
const PAGE_SIZE = 20;

type LibraryNode = Extract<NonNullable<LibraryEntriesQuery['node']>, { __typename: 'Library' }>;

/**
 * Deliberately still MASKED here: `edge.node` carries a `FragmentType` ref
 * for `BookRowFragment`/`SeriesRowFragment`, not the unwrapped fields.
 *
 * An earlier version of this page's data hook unmasked centrally and
 * returned concrete `BookRowFragmentFragment | SeriesRowFragmentFragment`
 * nodes. That forced iterating a HETEROGENEOUS array of two fragment types
 * in one place, which is what collided with `useFragment` needing to be
 * called unconditionally (`react-hooks/rules-of-hooks` — codegen's
 * `useFragment` is a plain identity cast today,
 * `src/gql/fragment-masking.ts`, but is deliberately named/shaped to mirror
 * Apollo's real cache-reactive `useFragment`, so the lint rule is right to
 * enforce this now even though nothing reactive is happening yet).
 *
 * Returning the ref instead removes the conflict rather than working around
 * it: each row component (`BookRowFromEntry`/`SeriesRow`) calls
 * `useFragment` exactly ONCE, unconditionally, in its own component body —
 * its own render context, not a shared iteration here. `__typename` is
 * readable on `node` WITHOUT unmasking (masking only wraps the fields
 * pulled in by the named fragment spread, not sibling selections like
 * `__typename` or the edge's own `cursor`), so this page can still
 * discriminate `Book` from `Series` (in the `.map()` below) before ever
 * calling `useFragment`.
 */
type LibraryEntryEdge = LibraryNode['entries']['edges'][number];

export const LibraryPage = () => {
  const style = useStyle();
  const [isAdmin] = useIsAdmin();
  const [targetLibraryId] = useLibraryTarget();
  // `UserListDocument` is imported from `~/graphql/user` (a leaf module —
  // this document has readers across multiple routes/providers, see its own
  // doc comment) — this only needs the count (for the "No users registered"
  // empty state), not any per-user field, so no fragment unmask is needed here.
  const { data: userListData, loading: userListLoading } = useQuery(UserListDocument, {
    skip: !isAdmin,
  });
  const userList = userListData?.viewer.users ?? [];
  const [bookListFilter, setBookListFilter] = useBookListFilter();

  // `useBookListFilter` recomputes a fresh `BookListFilter` object from URL
  // search params on every render (see that hook's own doc comment) — never
  // a stable reference. No `useMemo` dance is needed to stabilize it before
  // passing it on: `resetKey` below is a stringified PRIMITIVE
  // (`` `${libraryId}:${JSON.stringify(libraryFilter)}` ``), so
  // `usePaginatedConnection`'s stale-error reset only reacts to the
  // filter's VALUES, never its object identity (see that helper's own doc
  // comment, and `LibraryEntryEdge`'s sibling reasoning above).
  const libraryFilter = toLibraryFilter(bookListFilter);

  // **`loading` also covers `useCurrentLibraryId`'s own bootstrap round
  // trip** (review round 1, cold-load flash fix): a SKIPPED `useQuery`
  // reports `loading: false`, and on a cold load `libraryId` is `undefined`
  // for the ENTIRE `ViewerBootstrap` round trip — even for an admin with a
  // stored selection, since `useCurrentLibraryId` only trusts that
  // selection once it has learned `isAdmin` from that same query. Without
  // folding `useCurrentLibraryId`'s own `loading` in via `extraLoading`
  // below, this page's empty-state spinner (keyed off `loading` alone)
  // would see `edges: [], loading: false` for that whole window and render
  // "library is empty" instead — a false empty state on every cold load,
  // not a corner case.
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();

  // **Error-surfacing policy** (centralised in `usePaginatedConnection` —
  // see that helper's own doc comment for the full policy): `error` is a
  // single `string | undefined`, always Apollo's own `error?.message`. A
  // FIRST-PAGE failure is `useQuery`'s own `error` — at that point there is
  // no cached data yet, so `edges` is empty and this is the empty-error
  // state below. A `fetchMore` failure is caught by `usePaginatedConnection`
  // itself and surfaced through the SAME `error` field, with `edges` left
  // UNTOUCHED — existing rows survive, the page offers a retry
  // (`edges.length === 0` vs `> 0` is what distinguishes the two below).
  const { edges, loading, error, hasNextPage, loadMore } = usePaginatedConnection({
    document: LibraryEntriesDocument,
    variables: { libraryId: libraryId ?? '', first: PAGE_SIZE, filter: libraryFilter },
    skip: libraryId === undefined,
    select: (data) => (data?.node?.__typename === 'Library' ? data.node.entries : undefined),
    extraLoading: libraryIdLoading,
    resetKey: `${libraryId}:${JSON.stringify(libraryFilter)}`,
    loadMoreErrorMessage: 'Failed to load more entries',
  });
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error !== undefined || loading || !hasNextPage) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, error, loading, hasNextPage]);

  if (isAdmin && !targetLibraryId) {
    const noUsers = !userListLoading && userList.length === 0;
    return (
      <Page>
        <LibrarySwitcher />
        <div className={style.emptyState}>
          {noUsers ? (
            <>
              <div className={style.emptyStateTitle}>No users registered</div>
              <div className={style.emptyStateSubtitle}>
                Go to the{' '}
                <Link className={style.link} to={path.userList()}>
                  Users
                </Link>{' '}
                page to register the first user
              </div>
            </>
          ) : (
            <>
              <div className={style.emptyStateTitle}>Select a library</div>
              <div className={style.emptyStateSubtitle}>
                Choose a user above to view and manage their books
              </div>
            </>
          )}
        </div>
      </Page>
    );
  }

  if (!loading && error !== undefined && edges.length === 0) {
    return (
      <Page>
        <LibrarySwitcher />
        <div className={style.emptyState}>
          <div className={style.emptyStateTitle}>Failed to load library</div>
          <div className={style.emptyStateSubtitle}>{error}</div>
        </div>
      </Page>
    );
  }

  const isSearchActive =
    !!bookListFilter.query ||
    !!bookListFilter.author ||
    !!bookListFilter.seriesName ||
    !!bookListFilter.status ||
    (bookListFilter.subjects?.length ?? 0) > 0;

  const renderEdge = (edge: LibraryEntryEdge) =>
    edge.node.__typename === 'Series' ? (
      <SeriesRow key={edge.cursor} series={edge.node} />
    ) : (
      <BookRowFromEntry key={edge.cursor} book={edge.node} />
    );

  return (
    <Page>
      <LibrarySwitcher />
      <SearchBar filter={bookListFilter} onChange={setBookListFilter} />
      {edges.length === 0 ? (
        <div className={style.emptyState}>
          {loading ? (
            <SpinnerIcon role="status" aria-label="Loading" className={style.spinner} />
          ) : (
            <>
              <div className={style.emptyStateTitle}>
                {isSearchActive
                  ? 'No books match your search'
                  : `${isAdmin && targetLibraryId ? 'This' : 'Your'} library is empty`}
              </div>
              <div className={style.emptyStateSubtitle}>
                {isSearchActive
                  ? 'Try adjusting or clearing the filters above'
                  : 'No books have been added yet'}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className={style.root}>
          {edges.map(renderEdge)}
          {hasNextPage && <div ref={sentinelRef} />}
          {error !== undefined && edges.length > 0 && (
            <div className={style.pageError}>
              Failed to load more books
              <br />
              <button type="button" className={style.retryButton} onClick={loadMore}>
                Retry
              </button>
            </div>
          )}
        </div>
      )}
    </Page>
  );
};

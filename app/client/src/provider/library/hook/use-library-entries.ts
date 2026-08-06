import { useQuery } from '@apollo/client/react';
import { useCallback, useEffect, useState } from 'react';

import { useFragment } from '~/gql';
import type {
  BookRowFragmentFragment,
  LibraryFilter,
  SeriesRowFragmentFragment,
} from '~/gql/graphql';
import { BookRowFragment, LibraryEntriesDocument, SeriesRowFragment } from '~/graphql/library';
import { useCurrentLibraryId } from '~/provider/library-target';

/**
 * Matches `CONNECTION_LIMITS.libraryEntries.defaultSize` on the server
 * (`app/server/graphql/schema/pagination.ts`) — the size the server itself
 * falls back to when `first` is omitted. `$first` is non-null on
 * `LibraryEntriesDocument`, so this hook must always supply a value; picking
 * the server's own default keeps the two in agreement without importing
 * across the client/server boundary.
 */
const PAGE_SIZE = 20;

/**
 * Unmasked here, the same way `useScanProgress` unmasks `ScanStatusFields`
 * before returning it: this hook is the single place that requested
 * `BookRowFragment`/`SeriesRowFragment`, so it is the single place that
 * should call codegen's `useFragment` (a plain type-cast helper, not a React
 * hook — see that file's comment) to unwrap them, rather than pushing a
 * masked `FragmentType` ref downstream for every consumer to unwrap itself.
 */
export type LibraryEntryEdge =
  | { cursor: string; node: BookRowFragmentFragment }
  | { cursor: string; node: SeriesRowFragmentFragment };

export type UseLibraryEntries = {
  edges: LibraryEntryEdge[];
  loading: boolean;
  /** Apollo's `error?.message` — see this file's doc comment for what it covers. */
  error: string | undefined;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<void>;
};

/**
 * The grid's connection read for the current library: `node(id: $libraryId)
 * { ... on Library { entries } }`, filtered and paged.
 *
 * `Library.entries` already carries `relayStylePagination(['filter'])` in
 * `cacheConfig` (`provider/apollo/cache.ts`) — keyed on `filter`, so a
 * filter change starts a fresh list in the cache rather than appending to
 * the old one, and `fetchMore` below appends within the SAME filter. This
 * hook adds no second pagination policy; it only decides when to call
 * `fetchMore` and how to report the result of doing so.
 *
 * Skips the query outright when `libraryId` is `undefined` — an admin with
 * no library selected has nothing to root `node(id:)` on, and querying
 * anyway would be a wasted, guaranteed-empty round trip.
 *
 * **Error-surfacing policy** (spec §14.6 flagged that no such pattern
 * existed for screens and asked the next plan to decide one; this hook is
 * that decision, and every later screen hook should follow it): `error` is
 * a single `string | undefined`, always Apollo's own `error?.message`.
 *
 * A FIRST-PAGE failure is `useQuery`'s own `error` — at that point there is
 * no cached data yet, so `edges` is empty and this is the screen's
 * empty-error state.
 *
 * A `fetchMore` failure is different: Apollo does not thread a fetchMore
 * rejection into `useQuery`'s `error` at all — `fetchMore` runs with
 * `fetchPolicy: 'no-cache'` and only reaches the cache (and thus this
 * hook's `data`/`edges`) on success, so a failed page leaves the cached
 * `edges` completely untouched. This hook catches that rejection itself and
 * surfaces it through the SAME `error` field via local state, rather than
 * adding a second error slot — but because `edges` is untouched, a consumer
 * distinguishes the two cases exactly as `LibraryPage` already does today
 * (`bookListItems.length === 0` vs `> 0`): empty `edges` + `error` is the
 * empty-error state, non-empty `edges` + `error` is "keep the rows, show a
 * retry affordance". That distinction is the caller's job, not this hook's
 * — `useLibraryEntries` only guarantees `edges` survives a fetchMore
 * failure untouched and `error` reports it either way.
 */
export const useLibraryEntries = (filter: LibraryFilter | undefined): UseLibraryEntries => {
  const { libraryId } = useCurrentLibraryId();
  const [fetchMoreError, setFetchMoreError] = useState<string | undefined>(undefined);

  const { data, loading, error, fetchMore } = useQuery(LibraryEntriesDocument, {
    variables: { libraryId: libraryId ?? '', first: PAGE_SIZE, filter },
    skip: libraryId === undefined,
  });

  const library = data?.node?.__typename === 'Library' ? data.node : undefined;
  const rawEdges = library?.entries.edges ?? [];

  // `useFragment` must be called unconditionally, at this hook's own top
  // level — not per-edge inside a `.map` callback, which is indistinguishable
  // from a real conditional hook call to both the linter and, if this codegen
  // shim is ever swapped for Apollo's real (cache-reactive) `useFragment`, to
  // React itself. The two calls below unmask each type's edges as ONE batch
  // via `useFragment`'s array overload; the `.map` just after zips the two
  // unmasked arrays back into `rawEdges`' original order using plain index
  // arithmetic, no further hook calls involved.
  const bookNodes = useFragment(
    BookRowFragment,
    rawEdges.flatMap((edge) => (edge.node.__typename === 'Book' ? [edge.node] : []))
  );
  const seriesNodes = useFragment(
    SeriesRowFragment,
    rawEdges.flatMap((edge) => (edge.node.__typename === 'Series' ? [edge.node] : []))
  );

  let bookCursor = 0;
  let seriesCursor = 0;
  const edges: LibraryEntryEdge[] = rawEdges.map((edge) =>
    edge.node.__typename === 'Book'
      ? { cursor: edge.cursor, node: bookNodes[bookCursor++]! }
      : { cursor: edge.cursor, node: seriesNodes[seriesCursor++]! }
  );

  const hasNextPage = library?.entries.pageInfo.hasNextPage ?? false;
  const endCursor = library?.entries.pageInfo.endCursor ?? undefined;

  // A stale fetchMore failure belongs to the request that produced it: once
  // the target library or filter moves on to a different list, clear it
  // rather than let it linger over rows it never actually failed to load.
  useEffect(() => {
    setFetchMoreError(undefined);
  }, [libraryId, filter]);

  const fetchNextPage = useCallback(async () => {
    if (libraryId === undefined || !hasNextPage) return;
    try {
      await fetchMore({ variables: { after: endCursor } });
      setFetchMoreError(undefined);
    } catch (err) {
      setFetchMoreError(err instanceof Error ? err.message : 'Failed to load more entries');
    }
  }, [fetchMore, libraryId, hasNextPage, endCursor]);

  return {
    edges,
    loading,
    error: error?.message ?? fetchMoreError,
    hasNextPage,
    fetchNextPage,
  };
};

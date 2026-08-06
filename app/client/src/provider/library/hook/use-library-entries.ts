import { useQuery } from '@apollo/client/react';
import { useCallback, useEffect, useState } from 'react';

import type { LibraryEntriesQuery, LibraryFilter } from '~/gql/graphql';
import { LibraryEntriesDocument } from '~/graphql/library';
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

type LibraryNode = Extract<NonNullable<LibraryEntriesQuery['node']>, { __typename: 'Library' }>;

/**
 * Deliberately still MASKED here: `edge.node` carries a `FragmentType` ref
 * for `BookRowFragment`/`SeriesRowFragment`, not the unwrapped fields.
 *
 * An earlier version of this hook unmasked centrally (mirroring
 * `useScanProgress`'s handling of `ScanStatusFields`) and returned concrete
 * `BookRowFragmentFragment | SeriesRowFragmentFragment` nodes. That forced
 * iterating a HETEROGENEOUS array of two fragment types in one place, which
 * is what collided with `useFragment` needing to be called unconditionally
 * (`react-hooks/rules-of-hooks` — codegen's `useFragment` is a plain
 * identity cast today, `src/gql/fragment-masking.ts`, but is deliberately
 * named/shaped to mirror Apollo's real cache-reactive `useFragment`, so the
 * lint rule is right to enforce this now even though nothing reactive is
 * happening yet).
 *
 * Returning the ref instead removes the conflict rather than working around
 * it: each row component (`BookRow`/`SeriesRow`, Task 7/9) calls
 * `useFragment` exactly ONCE, unconditionally, in its own component body —
 * its own render context, not a shared iteration here. `__typename` is
 * readable on `node` WITHOUT unmasking (masking only wraps the fields
 * pulled in by the named fragment spread, not sibling selections like
 * `__typename` or the edge's own `cursor`), so this hook and any consumer
 * can still discriminate `Book` from `Series` before ever calling
 * `useFragment`.
 */
export type LibraryEntryEdge = LibraryNode['entries']['edges'][number];

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
 * `fetchMore` and how to report the result of doing so. `edges` is Apollo's
 * own array, passed through unchanged — no reordering, filtering, or
 * per-edge transform happens here (see `LibraryEntryEdge`'s doc comment for
 * why: that used to exist, in the form of a masked→unmasked zip, and was
 * deliberately removed).
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
  const edges = library?.entries.edges ?? [];
  const hasNextPage = library?.entries.pageInfo.hasNextPage ?? false;
  const endCursor = library?.entries.pageInfo.endCursor ?? undefined;

  // A stale fetchMore failure belongs to the request that produced it: once
  // the target library or filter moves on to a different list, clear it
  // rather than let it linger over rows it never actually failed to load.
  //
  // This depends on `libraryId`/`filter` REFERENCE stability to behave: a
  // caller that passes a freshly-literal `filter` object on every render
  // (rather than one held in state, as `useProbe` does in this hook's own
  // test) makes this effect fire every render, which can clear a legitimate
  // retry state before the screen ever gets to show it. Pass a stable
  // `filter` reference.
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

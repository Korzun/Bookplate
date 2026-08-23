import { useQuery } from '@apollo/client/react';
import { useCallback, useEffect, useState } from 'react';

import type { MyProgressListQuery } from '~/gql/graphql';
import { MyProgressListDocument } from '~/graphql/progress';
import { useCurrentLibraryId } from '~/provider/library-target';

/**
 * `Library.progress`'s own `defaultSize` (`CONNECTION_LIMITS.libraryProgress`
 * is `{ maxSize: 100, defaultSize: 50 }`, `app/server/graphql/schema/pagination.ts`)
 * — `MyProgressListDocument`'s own doc comment already recommends `first: 50`
 * for exactly this reason. `$first` is non-null on the document, so this hook
 * must always supply a value.
 */
const PAGE_SIZE = 50;

type LibraryNode = Extract<NonNullable<MyProgressListQuery['node']>, { __typename: 'Library' }>;

/**
 * Deliberately still MASKED here, mirroring `use-library-entries.ts`'s
 * `LibraryEntryEdge` (read that file's doc comment first — this hook is its
 * closest sibling): `node` carries a `FragmentType` ref for
 * `ProgressRowFragment`, not the unwrapped fields. Unlike that hook's
 * `edges`, this one is HOMOGENEOUS (every node is a `Progress`, never a
 * union of types), so returning unmasked data here would not itself trip
 * the `react-hooks/rules-of-hooks` hazard that forced `LibraryEntryEdge` to
 * stay masked. The masked shape is kept anyway, for the same reason every
 * other fetch-free row this migration has built keeps it: `MyProgressRow`
 * calls `useFragment` exactly once, unconditionally, in its own render
 * context, and that is the pattern every sibling row (`BookRowFromEntry`,
 * `SeriesRow`) already follows — one shape across the codebase beats an
 * exception for the one case where nothing technically forces it.
 *
 * `id` stays visible WITHOUT unmasking — it is a sibling selection on
 * `node` alongside the fragment spread (`node { id ...ProgressRowFragment
 * }` in `MyProgressListDocument`), not a field the fragment itself pulls
 * in, exactly like `__typename`/`cursor` on `LibraryEntryEdge`. That is
 * enough for `MyProgressContent` to key each row in its `.map()` without
 * unmasking anything.
 */
export type MyProgressRowRef = LibraryNode['progress']['edges'][number]['node'];

export type UseMyProgressList = {
  rows: MyProgressRowRef[];
  loading: boolean;
  /** Apollo's own `error?.message` — see this file's doc comment for what it covers. */
  error: string | undefined;
  hasNextPage: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  /**
   * The viewer's own Library global id, off this hook's own
   * `useCurrentLibraryId()` call — not a second resolution. `MyProgressContent`
   * threads this through to `MyProgressRow` so `LinkProgressModal` can root
   * its book picker (`LinkPickerBooksDocument`'s `node(id: $libraryId)`) at
   * the same library this list itself reads from, without `MyProgressRow`
   * calling `useCurrentLibraryId()` a second time per row.
   */
  libraryId: string | undefined;
};

/**
 * The viewer's own progress: `page/user`'s `MyProgress` card. Roots at
 * `node(id: $libraryId)` via `useCurrentLibraryId()`, matching
 * `useLibraryEntries`'s rooting rule.
 *
 * **`skip` is what makes the collapsed card fetch nothing.** The only
 * production caller, `MyProgressContent`, is itself a CHILD of `Card`'s
 * `isCollapsible`/`defaultCollapsed` pair (`component/card`), and `Card`
 * does not render its children into the tree AT ALL while collapsed
 * (`visibleChildren = isExpanded ? children : null`,
 * `component/card/index.tsx`) — so `MyProgressContent`, and this hook
 * called from its body, is never even MOUNTED while the card is collapsed.
 * In practice that makes `skip` always `false` at the one call site this
 * task wires up: the card's own mount/unmount IS the gate. `skip` stays a
 * required, explicit parameter regardless — rather than defaulting to
 * `false` internally — so this hook's own tests (and any future caller that
 * needs to mount ahead of expansion) can gate the query directly instead of
 * relying on a sibling component's mount timing as an implicit contract.
 *
 * Skips the query outright when `libraryId` is `undefined` too — an admin
 * with no library selected has nothing to root `node(id:)` on — same as
 * `useLibraryEntries`.
 *
 * **`loading` also covers `useCurrentLibraryId`'s own bootstrap round
 * trip**, same fix as `useLibraryEntries` (see that hook's doc comment) —
 * UNLESS `skip` is explicitly `true`, in which case there is nothing
 * mounted to show a loading state for, so `loading` reports `false`
 * regardless of `useCurrentLibraryId`'s own state.
 *
 * **Error-surfacing policy** — identical split to `useLibraryEntries`: a
 * first-page failure is `useQuery`'s own `error`, with `rows` empty (the
 * empty-error state). A `fetchMore` failure is caught locally and surfaced
 * through the same `error` field, with `rows` left untouched (existing rows
 * survive, offer a retry).
 */
export const useMyProgressList = ({ skip }: { skip: boolean }): UseMyProgressList => {
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();
  const [fetchMoreError, setFetchMoreError] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data, loading, error, fetchMore } = useQuery(MyProgressListDocument, {
    variables: { libraryId: libraryId ?? '', first: PAGE_SIZE },
    skip: skip || libraryId === undefined,
  });

  const library = data?.node?.__typename === 'Library' ? data.node : undefined;
  const edges = library?.progress.edges ?? [];
  const rows = edges.map((edge) => edge.node);
  const hasNextPage = library?.progress.pageInfo.hasNextPage ?? false;
  const endCursor = library?.progress.pageInfo.endCursor ?? undefined;

  // A stale fetchMore failure belongs to the request that produced it —
  // clear it once `libraryId`/`skip` move on, same reasoning as
  // `useLibraryEntries`'s identical effect.
  useEffect(() => {
    setFetchMoreError(undefined);
  }, [libraryId, skip]);

  const loadMore = useCallback(() => {
    if (libraryId === undefined || !hasNextPage || loadingMore) return;
    setLoadingMore(true);
    void (async () => {
      try {
        await fetchMore({ variables: { after: endCursor } });
        setFetchMoreError(undefined);
      } catch (err) {
        setFetchMoreError(err instanceof Error ? err.message : 'Failed to load more progress');
      } finally {
        setLoadingMore(false);
      }
    })();
  }, [fetchMore, libraryId, hasNextPage, endCursor, loadingMore]);

  return {
    rows,
    loading: skip ? false : loading || libraryIdLoading,
    error: error?.message ?? fetchMoreError,
    hasNextPage,
    loadMore,
    loadingMore,
    libraryId,
  };
};

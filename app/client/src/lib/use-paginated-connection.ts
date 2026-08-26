import { NetworkStatus, type OperationVariables, type TypedDocumentNode } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import { useCallback, useEffect, useState } from 'react';

/**
 * The public shape every "load a page of a Relay connection" hook in this
 * codebase now returns. `loading`/`loadingMore` are DISTINCT booleans on
 * purpose — see `usePaginatedConnection`'s own doc comment for why they
 * cannot be collapsed into Apollo's raw `loading`.
 */
export type PaginatedConnection<TEdge> = {
  edges: TEdge[];
  /** INITIAL load only — never Apollo's raw `loading`. */
  loading: boolean;
  /** `NetworkStatus.fetchMore` — a "load more" in flight. */
  loadingMore: boolean;
  error: string | undefined;
  hasNextPage: boolean;
  loadMore: () => void;
};

type Connection<TEdge> = {
  edges: TEdge[];
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
};

export type UsePaginatedConnectionOptions<TData, TVariables extends OperationVariables, TEdge> = {
  document: TypedDocumentNode<TData, TVariables>;
  variables: TVariables;
  skip?: boolean;
  /** Extracts the connection from the query root. Returns `undefined` while unresolved. */
  select: (data: TData | undefined) => Connection<TEdge> | undefined;
  /**
   * Folded into `loading`, ADDITIVELY — e.g. `useCurrentLibraryId`'s own
   * bootstrap round trip. A caller that needs this term to NOT apply while
   * its own `skip` is `true` (`useMyProgressList`'s "collapsed card" case —
   * see that hook's doc comment) computes that itself before passing
   * `extraLoading` in; this helper only ORs whatever it is given. See this
   * function's own doc comment, point (1), for why the fold can't happen
   * inside a `skip`-gated branch here.
   */
  extraLoading?: boolean;
  /** PRIMITIVE list identity. A change clears a stale `fetchMore` error. */
  resetKey: string;
  loadMoreErrorMessage: string;
};

/**
 * One state machine for every hand-rolled "Relay connection + fetchMore"
 * hook this codebase had (`useLibraryEntries`, `useMyProgressList`,
 * `useUserProgressList`, and `LinkProgressModal`'s inline version) —
 * replacing four near-identical copies of the same `useState`/`useEffect`/
 * `useCallback` dance with one.
 *
 * Three constraints drove this shape; get any one wrong and it ships a bug:
 *
 * **(1) `notifyOnNetworkStatusChange: true` is REQUIRED, and it poisons
 * `loading`.** Without it, `networkStatus` never updates during `fetchMore`
 * at all, so `loadingMore` cannot be derived from it. WITH it, Apollo's own
 * `loading` becomes `true` during `fetchMore` too — not just on initial
 * load — so `loading` below is derived from `networkStatus`
 * (`NetworkStatus.loading` / `NetworkStatus.setVariables`), NEVER from the
 * raw `loading` this hook discards. Passing raw `loading` through would
 * flash the screen's empty/loading state on every "load more" click.
 *
 * That formula deliberately has NO `skip ? false : ...` gate, unlike a
 * first draft of this helper: `skip` here is often the COMBINED skip fed to
 * `useQuery` (e.g. `useLibraryEntries` skips whenever `libraryId` is still
 * `undefined`, including during `useCurrentLibraryId`'s own bootstrap round
 * trip) — gating the `networkStatus` check on that same `skip` would zero
 * out `extraLoading` for exactly the window it exists to cover, and
 * silently reintroduce the "cold load renders a false empty state" bug this
 * helper's callers depend on staying fixed. Apollo itself already reports a
 * skipped query's `networkStatus` as neither `loading` nor `setVariables`,
 * so no explicit gate is needed for the query-in-flight half of this
 * formula; `extraLoading` is simply ORed in on top, additively.
 *
 * **(2) A `fetchMore` rejection is NOT threaded into `useQuery`'s `error`.**
 * `fetchMore` runs with `fetchPolicy: 'no-cache'` and only reaches the
 * cache on success, so a failed page leaves cached edges untouched. This
 * hook catches the rejection itself and surfaces it through the SAME
 * `error` field via local state — `networkStatus` does not remove this
 * need.
 *
 * **(3) Error-surfacing policy** (originated in `use-library-entries.ts`,
 * now centralised here): one `error: string | undefined`, always Apollo's
 * own `error?.message`. A first-page failure is `useQuery`'s own `error`,
 * with `edges` empty — the caller's empty-error state. A `fetchMore`
 * failure is caught locally and surfaced through the same `error` field,
 * with `edges` left UNTOUCHED — existing rows survive, the caller offers a
 * retry. Distinguishing the two remains the CALLER's job (`edges.length ===
 * 0` vs `> 0`), exactly as before.
 *
 * **`resetKey` is a PRIMITIVE**, replacing the reference-compared
 * `useEffect(..., [libraryId, filter])` reset every hand-rolled predecessor
 * used: a caller passing a fresh `filter` object literal every render fired
 * that effect every render, and could clear a legitimate retry state before
 * the screen ever showed it (`use-library-entries.ts`'s own former doc
 * comment warned about exactly this, and `page/library` still works around
 * it with a `JSON.stringify` + `useMemo` dance — Task 5 owns removing that
 * workaround, not this task). A primitive key removes the footgun instead
 * of documenting it.
 *
 * The returned object also carries `data: TData | undefined` — the RAW
 * query data, beyond the `PaginatedConnection<TEdge>` contract above. Three
 * of this helper's four call sites need nothing else, but
 * `useUserProgressList` also exposes `libraryId` off `data.user.library.id`,
 * a SIBLING field on the same query root next to the `progress` connection
 * itself (not a second fetch) — `select` alone (which only ever sees the
 * connection shape) cannot reach it. Exposing `data` lets that one caller
 * pull it back out without this helper growing a bespoke "and also return
 * this other field" parameter, and without a second `useQuery` call for the
 * same document/variables.
 */
export const usePaginatedConnection = <TData, TVariables extends OperationVariables, TEdge>({
  document,
  variables,
  skip = false,
  select,
  extraLoading = false,
  resetKey,
  loadMoreErrorMessage,
}: UsePaginatedConnectionOptions<TData, TVariables, TEdge>): PaginatedConnection<TEdge> & {
  data: TData | undefined;
} => {
  const [fetchMoreError, setFetchMoreError] = useState<string | undefined>(undefined);

  const { data, error, fetchMore, networkStatus } = useQuery(document, {
    variables,
    skip,
    // REQUIRED — see constraint (1) above.
    notifyOnNetworkStatusChange: true,
  });

  const connection = select(data);
  const edges = connection?.edges ?? [];
  const hasNextPage = connection?.pageInfo.hasNextPage ?? false;
  const endCursor = connection?.pageInfo.endCursor ?? undefined;

  const loadingMore = networkStatus === NetworkStatus.fetchMore;
  const loading =
    networkStatus === NetworkStatus.loading ||
    networkStatus === NetworkStatus.setVariables ||
    extraLoading;

  // A stale fetchMore failure belongs to the request that produced it: once
  // the underlying list identity moves on (a new `resetKey`), clear it
  // rather than let it linger over rows it never actually failed to load.
  useEffect(() => {
    setFetchMoreError(undefined);
  }, [resetKey]);

  const loadMore = useCallback(() => {
    if (skip || !hasNextPage || loadingMore) return;
    void (async () => {
      try {
        // `TVariables` is abstract here — every real document this helper
        // pages through has an `after: String` variable (that is the whole
        // point of a Relay-style connection), but TS can't prove that for a
        // generic `TVariables extends OperationVariables`, and `fetchMore`'s
        // own `variables?: Partial<NoInfer<TFetchVars>>` type blocks
        // inferring a narrower `TFetchVars` from this call site (`NoInfer`
        // pins it back to `TVariables`). The cast is the documented
        // contract, not a loophole.
        await fetchMore({ variables: { after: endCursor } as unknown as Partial<TVariables> });
        setFetchMoreError(undefined);
      } catch (err) {
        // fetchMore rejections are NOT threaded into useQuery's `error` —
        // constraint (2) above.
        setFetchMoreError(err instanceof Error ? err.message : loadMoreErrorMessage);
      }
    })();
  }, [skip, hasNextPage, loadingMore, fetchMore, endCursor, loadMoreErrorMessage]);

  return {
    data,
    edges,
    loading,
    loadingMore,
    error: error?.message ?? fetchMoreError,
    hasNextPage,
    loadMore,
  };
};

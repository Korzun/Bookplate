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

export type UsePaginatedConnectionOptions<
  TData,
  TVariables extends OperationVariables & { after?: string | null },
  TEdge,
> = {
  document: TypedDocumentNode<TData, TVariables>;
  variables: TVariables;
  skip?: boolean;
  /** Extracts the connection from the query root. Returns `undefined` while unresolved. */
  select: (data: TData | undefined) => Connection<TEdge> | undefined;
  /**
   * Folded into `loading`, ADDITIVELY — e.g. `useCurrentLibraryId`'s own
   * bootstrap round trip. A caller that needs this term to NOT apply while
   * its own `skip` is `true` (`MyProgressContent`'s "collapsed card" case —
   * see that component's own doc comment) computes that itself before
   * passing `extraLoading` in; this helper only ORs whatever it is given.
   * See this function's own doc comment, point (1), for why the fold can't
   * happen inside a `skip`-gated branch here.
   */
  extraLoading?: boolean;
  /** PRIMITIVE list identity. A change clears a stale `fetchMore` error. */
  resetKey: string;
  loadMoreErrorMessage: string;
};

/**
 * One state machine for every hand-rolled "Relay connection + fetchMore"
 * hook/component this codebase had — replacing four near-identical copies
 * of the same `useState`/`useEffect`/`useCallback` dance with one. The
 * four ORIGINAL predecessors (Task 3): `useLibraryEntries`, the viewer's
 * own progress list (`useMyProgressList`, since dissolved into
 * `component/my-progress-content`, Task 4), the admin's per-user progress
 * list (`useUserProgressList`, since dissolved into
 * `component/user-row-content`, Task 4), and `LinkProgressModal`'s own
 * inline version. Current call sites: `use-library-entries.ts`,
 * `component/my-progress-content`, `component/user-row-content`,
 * `control/link-progress-modal`.
 *
 * Three constraints drove this shape; get any one wrong and it ships a bug:
 *
 * **(1) `notifyOnNetworkStatusChange: true` is pinned explicitly, and it
 * poisons `loading`.** Apollo v4 already DEFAULTS this option to `true` —
 * every one of this helper's four predecessors relied on that default
 * implicitly and never set it, which is exactly why `page/library` and
 * `LinkProgressModal` were already flashing their loading state on every
 * "load more" click before this task (`LinkProgressModal` even swapped its
 * whole book list for "Loading books…" mid-pagination). It is set
 * explicitly here anyway, to pin the behaviour this helper depends on
 * against a future default change rather than inherit it silently. The
 * poisoning: with it on, Apollo's own `loading` is `true` during `fetchMore`
 * too — not just on initial load — so `loading` below is derived from
 * `networkStatus` (`NetworkStatus.loading` / `NetworkStatus.setVariables`)
 * instead, NEVER from the raw `loading` this hook discards. Passing raw
 * `loading` through is what caused the pre-existing flash described above.
 *
 * That formula deliberately has NO `skip ? false : ...` gate, unlike a
 * first draft of this helper: `skip` here is often the COMBINED skip fed to
 * `useQuery` (e.g. `page/library`'s `LibraryPage` skips whenever `libraryId`
 * is still `undefined`, including during `useCurrentLibraryId`'s own
 * bootstrap round trip) — gating the `networkStatus` check on that same
 * `skip` would zero out `extraLoading` for exactly the window it exists to
 * cover, and
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
 * query data, beyond the `PaginatedConnection<TEdge>` contract above (that
 * exported type itself stays exactly the 6-field public shape; `data` only
 * ever appears on THIS function's own inferred return type, not on anything
 * a caller can declare a variable's type as without also getting it). Three
 * of this helper's four call sites need nothing else, but
 * `component/user-row-content`'s `UserRowContent` also exposes `libraryId`
 * off `data.user.library.id`, a SIBLING field on the same query root next
 * to the `progress` connection itself (not a second fetch) — `select`
 * alone (which only ever sees the connection shape) cannot reach it.
 * Exposing `data` lets that one caller pull it back out without this
 * helper growing a bespoke "and also return this other field" parameter,
 * and without a second `useQuery` call for the same document/variables.
 *
 * `data` is deliberately a SINGLE-CALLER exception, not a general escape
 * hatch: it exists because exactly one of the four current call sites needs
 * exactly one sibling field. If a SECOND caller ever needs a sibling field
 * off the query root, that is the signal to replace `data` with something
 * more structured — e.g. an optional `selectExtra` alongside `select`, or
 * having `select` itself return `{ connection, extra }` — not to keep
 * reaching into raw `data` from more call sites. Widening what a shared
 * helper exposes "just in case" is exactly the kind of drift this task
 * exists to remove, not add back.
 */
export const usePaginatedConnection = <
  TData,
  TVariables extends OperationVariables & { after?: string | null },
  TEdge,
>({
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
    // v4 defaults this to `true`; pinned explicitly here because `loading`'s
    // derivation below depends on it — see constraint (1) above.
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
        // `TVariables` is constrained to carry `after?: string | null` (see
        // this file's generic parameters) — checked, not just commented, so
        // a document that paginates by `offset`/`page` instead of a cursor
        // can't be plugged into this helper: `loadMore` would otherwise send
        // an undeclared `after` variable, graphql-js would silently ignore
        // it, and `fetchMore` would refetch page 1 forever — a silent no-op
        // "infinite scroll" with no error anywhere. The cast is still needed
        // because `fetchMore`'s own `variables?: Partial<NoInfer<TFetchVars>>`
        // blocks inferring a narrower `TFetchVars` from this call site
        // (`NoInfer` pins it back to `TVariables`), not because the shape is
        // unproven.
        await fetchMore({ variables: { after: endCursor } as Partial<TVariables> });
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

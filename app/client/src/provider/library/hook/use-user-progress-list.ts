import { useQuery } from '@apollo/client/react';
import { useCallback, useEffect, useState } from 'react';

import type { UserProgressListQuery } from '~/gql/graphql';
import { UserProgressListDocument } from '~/graphql/progress';

/**
 * Same rationale as `use-my-progress-list.ts`'s own `PAGE_SIZE` doc comment:
 * `Library.progress`'s `defaultSize` is 50
 * (`CONNECTION_LIMITS.libraryProgress`, `app/server/graphql/schema/pagination.ts`),
 * and `$first` is non-null on `UserProgressListDocument` too, so this hook
 * must always supply a value.
 */
const PAGE_SIZE = 50;

type UserLibrary = NonNullable<UserProgressListQuery['user']>['library'];

/**
 * Deliberately still MASKED, for the exact reason
 * `use-my-progress-list.ts`'s `MyProgressRowRef` gives — `UserProgressRow`
 * calls `useFragment` exactly once, unconditionally, in its own render
 * context, matching every other fetch-free row this migration has built.
 *
 * `id` stays visible WITHOUT unmasking, same as `MyProgressRowRef` — a
 * sibling selection on `node` alongside the fragment spread, not a field
 * the fragment itself pulls in.
 */
export type UserProgressRowRef = UserLibrary['progress']['edges'][number]['node'];

export type UseUserProgressList = {
  rows: UserProgressRowRef[];
  loading: boolean;
  /** Apollo's own `error?.message` — see this file's doc comment for what it covers. */
  error: string | undefined;
  hasNextPage: boolean;
  loadMore: () => void;
  loadingMore: boolean;
};

/**
 * An admin's view of ANOTHER user's progress: `UserRowContent`'s row list.
 * Roots at `Query.user(id: $userId) { library { progress ... } }`, not
 * `node(id: $libraryId)` — the target is a different user's library, and
 * `UserRow` already holds their `userId` (a User global id from an earlier
 * step's `/users` migration), so this hook takes it as a plain argument
 * rather than resolving it internally. `Query.user(id:)` is admin-only and
 * refuses even a non-admin's OWN id (schema-verified,
 * `graphql/progress.ts`'s own doc comment on `UserProgressListDocument`) —
 * correct here, since this hook's one caller (`UserRowContent`) only ever
 * mounts on a screen the nav itself hides from non-admins
 * (`component/nav/index.tsx`'s `isAdmin` gate on the "Users" link).
 *
 * Unlike `useMyProgressList`, `userId` is supplied directly by the caller —
 * there is no internal id-resolution step (no `useCurrentLibraryId`
 * equivalent to bootstrap), so `loading` needs no extra term folded in: it
 * is `useQuery`'s own `loading`, which Apollo itself already reports as
 * `false` while `skip` is `true`.
 *
 * `skip` stays a required, explicit parameter, matching
 * `useMyProgressList`'s convention — `UserRowContent`'s one call site is
 * itself a CHILD of `Card`'s `isCollapsible`/`defaultCollapsed` pair
 * (`component/user-row`), which does not render its children into the tree
 * at all while collapsed, so `skip: false` is always correct there; `skip`
 * still exists as its own parameter so this hook's tests can gate the query
 * directly.
 *
 * **Error-surfacing policy** — identical split to `useMyProgressList`: a
 * first-page failure is `useQuery`'s own `error`, with `rows` empty (the
 * empty-error state). A `fetchMore` failure is caught locally and surfaced
 * through the same `error` field, with `rows` left untouched (existing rows
 * survive, offer a retry).
 */
export const useUserProgressList = (
  userId: string,
  { skip }: { skip: boolean }
): UseUserProgressList => {
  const [fetchMoreError, setFetchMoreError] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data, loading, error, fetchMore } = useQuery(UserProgressListDocument, {
    variables: { userId, first: PAGE_SIZE },
    skip,
  });

  const library = data?.user?.library;
  const edges = library?.progress.edges ?? [];
  const rows = edges.map((edge) => edge.node);
  const hasNextPage = library?.progress.pageInfo.hasNextPage ?? false;
  const endCursor = library?.progress.pageInfo.endCursor ?? undefined;

  // A stale fetchMore failure belongs to the request that produced it —
  // clear it once `userId`/`skip` move on, same reasoning as
  // `useMyProgressList`'s identical effect.
  useEffect(() => {
    setFetchMoreError(undefined);
  }, [userId, skip]);

  const loadMore = useCallback(() => {
    if (!hasNextPage || loadingMore) return;
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
  }, [fetchMore, hasNextPage, endCursor, loadingMore]);

  return {
    rows,
    loading,
    error: error?.message ?? fetchMoreError,
    hasNextPage,
    loadMore,
    loadingMore,
  };
};

import type { UserProgressListQuery } from '~/gql/graphql';
import { UserProgressListDocument } from '~/graphql/progress';
import { usePaginatedConnection } from '~/lib/use-paginated-connection';

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
 * sibling selection on `node` alongside the fragment spread, not part of
 * the fragment itself.
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
  /**
   * The target user's Library global id, off this SAME query's `user.library.id`
   * (already selected in `UserProgressListDocument`, not a second fetch).
   * `undefined` until the first page resolves. `UserRowContent` threads this
   * through to `UserProgressRow` so `LinkProgressModal` can root its book
   * picker (`LinkPickerBooksDocument`'s `node(id: $libraryId)`) at the
   * TARGET user's library — not `useCurrentLibraryId()`'s admin `library-target`
   * selection, which is a single global choice unrelated to any one row on
   * the Users page (see `control/link-progress-modal`'s own doc comment for
   * the full reasoning).
   *
   * Pulled off `usePaginatedConnection`'s raw `data` — that helper's own
   * `select` only ever sees the `progress` CONNECTION shape, so it cannot
   * reach a sibling field like `library.id` next to it. `data` is exposed
   * on the helper's return specifically for cases like this one (see that
   * helper's doc comment).
   */
  libraryId: string | undefined;
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
 * equivalent to bootstrap), so `loading` needs no extra term folded in:
 * `usePaginatedConnection` is called with no `extraLoading`, so `loading`
 * is derived purely from `networkStatus`, which Apollo itself already
 * reports as not-loading while `skip` is `true`.
 *
 * `skip` stays a required, explicit parameter, matching
 * `useMyProgressList`'s convention — `UserRowContent`'s one call site is
 * itself a CHILD of `Card`'s `isCollapsible`/`defaultCollapsed` pair
 * (`component/user-row`), which does not render its children into the tree
 * at all while collapsed, so `skip: false` is always correct there; `skip`
 * still exists as its own parameter so this hook's tests can gate the query
 * directly.
 *
 * **Error-surfacing policy** — identical split to `useMyProgressList`, both
 * now implemented by `usePaginatedConnection` (see that helper's doc
 * comment for the full policy): a first-page failure is `useQuery`'s own
 * `error`, with `rows` empty (the empty-error state). A `fetchMore` failure
 * is caught locally and surfaced through the same `error` field, with
 * `rows` left untouched (existing rows survive, offer a retry).
 */
export const useUserProgressList = (
  userId: string,
  { skip }: { skip: boolean }
): UseUserProgressList => {
  const { data, edges, loading, loadingMore, error, hasNextPage, loadMore } =
    usePaginatedConnection({
      document: UserProgressListDocument,
      variables: { userId, first: PAGE_SIZE },
      skip,
      select: (d) => d?.user?.library?.progress,
      resetKey: `${userId}:${skip}`,
      loadMoreErrorMessage: 'Failed to load more progress',
    });

  return {
    rows: edges.map((edge) => edge.node),
    loading,
    error,
    hasNextPage,
    loadMore,
    loadingMore,
    libraryId: data?.user?.library?.id,
  };
};

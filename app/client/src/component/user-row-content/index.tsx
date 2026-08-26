import cx from 'classnames';
import { Fragment } from 'react';

import { Button } from '~/control';
import { graphql } from '~/gql';
import { usePaginatedConnection } from '~/lib/use-paginated-connection';

import { UserProgressRow } from '../user-progress-row';
import { useStyle } from './style';

/**
 * An admin's view of ANOTHER user's progress: `UserRowContent`'s row list.
 * Roots at `Query.user(id: $userId) { library { progress ... } }`, not
 * `node(id: $libraryId)` — the target is a different user's library, and
 * `UserRow` already holds their `userId`. `Query.user(id:)` is admin-only,
 * which is correct here: this row list renders only for admins.
 *
 * Same `$first`-is-a-variable pricing as `MyProgressListDocument`
 * (`component/my-progress-content`): the `progress` connection prices at
 * `maxSize` (100), not the 50 passed.
 *
 * Declared HERE rather than a route file or `graphql/progress.ts` (project
 * ruling J): this component is a CHILD of `Card`'s
 * `isCollapsible`/`defaultCollapsed` pair (`component/user-row`), which
 * does not render its children into the tree AT ALL while collapsed — so
 * this component, and the query it owns, is never even MOUNTED until the
 * card is expanded. That mount/unmount IS the lazy gate spec 3.4 asks for.
 *
 * Hoisting this document to `page/user-list` (spec 3.1's normal "the route
 * composes the query" rule) would be a severe COST regression, not just an
 * architectural one: `page/user-list` is per-VIEWER, but this document is
 * per-USER, so composing it there would fetch progress for EVERY user on
 * EVERY visit, under `Viewer.users`'s ×50 cost multiplier.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 33 (33.0%), complexity
 * 2508 (7.6%) of budget.
 */
export const UserProgressListDocument = graphql(`
  query UserProgressList($userId: ID!, $first: Int!, $after: String) {
    user(id: $userId) {
      id
      library {
        id
        progress(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              ...ProgressRowFragment
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
 * Same rationale as `MyProgressListDocument`'s own `PAGE_SIZE` doc comment:
 * `Library.progress`'s `defaultSize` is 50 (`CONNECTION_LIMITS.libraryProgress`,
 * `app/server/graphql/schema/pagination.ts`), and `$first` is non-null on
 * `UserProgressListDocument` too, so this component must always supply a
 * value.
 */
const PAGE_SIZE = 50;

interface UserRowContentProps {
  /** The target user's Relay global id — from `UserRow`'s own `userId` prop. */
  userId: string;
  username: string;
  /**
   * **What makes the collapsed card fetch nothing.** This component's own
   * PARENT (`UserRow`) always passes `false` at its one production call
   * site — `UserRow` never mounts this component while `Card` is collapsed
   * (`Card` does not render its children into the tree at all while
   * collapsed, mirroring `component/my-progress`), so `skip` is always
   * `false` in practice there. `skip` stays a required, EXPLICIT prop
   * regardless — rather than defaulting to `false` internally — so this
   * component's own tests can gate the query directly instead of depending
   * on `Card`'s mount timing as an implicit contract.
   */
  skip: boolean;
}

/**
 * A CHILD of `Card`'s `isCollapsible`/`defaultCollapsed` pair
 * (`component/user-row`), which does not render its children into the tree
 * at all while collapsed — so this component is only ever MOUNTED while
 * the card is expanded, and `skip: false` is always what `UserRow` passes
 * at that one call site. Mirrors `MyProgressContent`
 * (`component/my-progress-content`) closely — see that component's own doc
 * comment for the full mechanism — rooted at `Query.user(id: $userId)`
 * instead of the viewer's own library.
 *
 * Renders rows fetch-free off `UserProgressList`'s connection: each
 * `UserProgressRow` unmasks its own `ProgressRowFragment` ref rather than
 * this component calling `useBook`/`useUserProgress` per row (the old REST
 * shape) or unmasking centrally in this `.map()`.
 *
 * Unlike `MyProgressContent`, `userId` is supplied directly by the caller —
 * there is no internal id-resolution step (no `useCurrentLibraryId`
 * equivalent to bootstrap), so `loading` needs no extra term folded in:
 * `usePaginatedConnection` is called with no `extraLoading`, so `loading`
 * is derived purely from `networkStatus`, which Apollo itself already
 * reports as not-loading while `skip` is `true`.
 *
 * **Error-surfacing policy** — identical split to `MyProgressContent`, both
 * implemented by `usePaginatedConnection` (see that helper's own doc
 * comment for the full policy): a first-page failure is `useQuery`'s own
 * `error`, with `rows` empty (the empty-error state). A `fetchMore` failure
 * is caught locally and surfaced through the same `error` field, with
 * `rows` left untouched (existing rows survive, offer a retry).
 */
export const UserRowContent = ({ userId, username, skip }: UserRowContentProps) => {
  const styles = useStyle();

  const { data, edges, loading, error, hasNextPage, loadMore, loadingMore } =
    usePaginatedConnection({
      document: UserProgressListDocument,
      variables: { userId, first: PAGE_SIZE },
      skip,
      select: (d) => d?.user?.library?.progress,
      resetKey: `${userId}:${skip}`,
      loadMoreErrorMessage: 'Failed to load more progress',
    });
  const rows = edges.map((edge) => edge.node);
  /**
   * The TARGET user's own Library global id, off this SAME query's
   * `user.library.id` (already selected above, not a second fetch) —
   * `usePaginatedConnection`'s `select` only ever sees the `progress`
   * CONNECTION shape, so it cannot reach a sibling field like `library.id`
   * next to it; `data` is exposed on that helper's return specifically for
   * cases like this one (see its own doc comment). `undefined` until the
   * first page resolves. Threaded through to `UserProgressRow` so
   * `LinkProgressModal` can root its book picker at the TARGET user's
   * library — not `useCurrentLibraryId()`'s admin `library-target`
   * selection, which is a single global choice unrelated to any one row on
   * the Users page.
   */
  const libraryId = data?.user?.library?.id;

  if (loading) {
    return <div className={styles.message}>Loading...</div>;
  }
  // A first-page failure (no rows loaded yet) is the empty-error state. A
  // `fetchMore` failure with existing rows falls through to the list below,
  // which renders its own inline retry instead of replacing the rows.
  if (error && rows.length === 0) {
    return <div className={cx(styles.message, styles.error)}>Error loading user progress</div>;
  }
  if (rows.length === 0) {
    return <div className={styles.message}>No progress synced</div>;
  }

  return (
    <Fragment>
      {rows.map((row) => (
        <UserProgressRow key={row.id} progress={row} username={username} libraryId={libraryId} />
      ))}
      {hasNextPage && (
        <Button type="link" onClick={loadMore} loading={loadingMore}>
          Load more
        </Button>
      )}
      {error && rows.length > 0 && (
        <div className={cx(styles.message, styles.error)}>
          Failed to load more progress
          <Button type="link" onClick={loadMore}>
            Retry
          </Button>
        </div>
      )}
    </Fragment>
  );
};

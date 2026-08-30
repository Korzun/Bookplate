import { useApolloClient, useMutation } from '@apollo/client/react';
import cx from 'classnames';
import { Fragment, useCallback } from 'react';

import { BookRequestRow } from '~/component/book-request-row';
import { Button } from '~/control';
import { BookRequestDeleteDocument, UserRequestListDocument } from '~/graphql/book-request';
import { UserListDocument } from '~/graphql/user';
import { usePaginatedConnection } from '~/lib/use-paginated-connection';

import { useStyle } from './style';

interface UserRequestListProps {
  /** The target user's Relay global id — `UserRow`'s own `userId` prop. */
  userId: string;
  /**
   * **What makes the collapsed card fetch nothing.** This component's own
   * PARENT (`UserRowContent`) always passes `false` at its one production
   * call site — `UserRow` never mounts `UserRowContent` (and, in turn, this
   * component) while `Card` is collapsed. `skip` stays a required, EXPLICIT
   * prop regardless — rather than defaulting to `false` internally — so this
   * component's own tests can gate the query directly instead of depending on
   * `Card`'s mount timing as an implicit contract. Mirrors `UserRowContent`'s
   * identical prop for the identical reason.
   */
  skip: boolean;
}

/**
 * An admin's view of ANOTHER user's book requests — `UserRowContent`'s
 * request-list half, structurally a copy of its progress-list half (read
 * that component's own doc comment first): `usePaginatedConnection` over
 * `Query.user(id: $userId) { bookRequests }`, not `viewer.user.bookRequests`
 * — the target is a different user's requests, and `UserRow` already holds
 * their `userId`. `Query.user(id:)` is admin-only, which is correct here:
 * this list renders only for admins.
 *
 * **A SEPARATE document from `UserProgressListDocument`** (`component/
 * user-row-content`) because the two lists page independently — a `Load
 * more` on one must not affect the other's cursor. Declared HERE, not on
 * `page/user-list`, for the SAME reason `UserProgressListDocument` is: this
 * component is a CHILD of `Card`'s `isCollapsible`/`defaultCollapsed` pair,
 * which does not render its children into the tree at all while collapsed —
 * so this component, and the query it owns, is never even MOUNTED until the
 * card is expanded. Hoisting it to `page/user-list` (a per-VIEWER route)
 * would fetch it for EVERY user on EVERY visit, under `Viewer.users`'s ×50
 * cost multiplier — a severe cost regression, not just an architectural one.
 *
 * `first: 20` on `UserRequestListDocument` is a LITERAL, not a variable, for
 * the same pricing reason `MyBookRequestListDocument` gives (`graphql/
 * book-request.ts`): the cost model prices a variable page size at the
 * field's `maxSize`, not the value passed.
 *
 * Rows are `BookRequestRow` with `canResolve` and a `target` — the
 * requesting reader's Library global id and username, off this SAME query's
 * `user.library.id`/`user.username` (`UserRequestListDocument`, Task 14) —
 * `undefined` until the first page resolves. `BookRequestRow`'s own upload
 * control captures BOTH halves on the queue item at add time
 * (`addFiles(files, { target, fulfillsRequestId })`), so the bytes land in
 * THIS reader's library and the queue can close THIS request, whatever the
 * admin's global library switcher currently points at — the same "root at
 * the TARGET user, not the admin's own selection" shape `UserRowContent`
 * already follows for `LinkProgressModal`'s `libraryId`. `onDelete` runs
 * `BookRequestDeleteDocument`, evicts the returned `deletedId` from the
 * cache (which already drops the now-dangling edge from this list's own
 * `relayStylePagination`-held connection — `provider/apollo/cache.ts`'s
 * `User.bookRequests` typePolicy, same mechanism `BookRequestsContent`
 * documents), and refetches `UserListDocument` (`~/graphql/user`) — the
 * query `page/user-list` mounts, which carries `UserRowFragment`'s
 * `pendingBookRequestCount` badge. That count is a server-computed
 * `t.relationCount` with no client-visible increment/decrement, so without
 * this refetch a cleared/withdrawn request would leave the badge stale.
 * `refetchQueries({ include: [...] })` only refetches ACTIVE queries, so
 * this is harmless even if, say, `page/user-list` is not currently mounted.
 *
 * **Error-surfacing policy** — identical split to `UserRowContent` and
 * `BookRequestsContent`, both implemented by `usePaginatedConnection`: a
 * first-page failure is `useQuery`'s own `error`, with `rows` empty (the
 * empty-error state). A `fetchMore` failure is caught locally and surfaced
 * through the same `error` field, with `rows` left untouched (existing rows
 * survive, offer a retry).
 */
export const UserRequestList = ({ userId, skip }: UserRequestListProps) => {
  const styles = useStyle();
  const client = useApolloClient();
  const [runDelete] = useMutation(BookRequestDeleteDocument);

  const { data, edges, loading, error, hasNextPage, loadMore, loadingMore } =
    usePaginatedConnection({
      document: UserRequestListDocument,
      variables: { userId },
      skip,
      select: (d) => d?.user?.bookRequests,
      resetKey: `${userId}:${skip}`,
      loadMoreErrorMessage: 'Failed to load more requests',
    });
  const rows = edges.map((edge) => edge.node);
  const libraryId = data?.user?.library?.id;
  const username = data?.user?.username;
  const target =
    libraryId !== undefined && username !== undefined ? { libraryId, username } : undefined;

  const handleDelete = useCallback(
    (id: string) => {
      void (async () => {
        const { data: deleteData } = await runDelete({
          variables: { id },
          update: (cache, { data: mutationData }) => {
            const deletedId = mutationData?.bookRequestDelete?.deletedId;
            if (!deletedId) return;
            cache.evict({ id: cache.identify({ __typename: 'BookRequest', id: deletedId }) });
            cache.gc();
          },
        });
        if (deleteData?.bookRequestDelete?.deletedId) {
          await client.refetchQueries({ include: [UserListDocument] });
        }
      })();
    },
    [runDelete, client]
  );

  if (loading) {
    return <div className={styles.message}>Loading...</div>;
  }
  // A first-page failure (no rows loaded yet) is the empty-error state. A
  // `fetchMore` failure with existing rows falls through to the list below,
  // which renders its own inline retry instead of replacing the rows.
  if (error && rows.length === 0) {
    return <div className={cx(styles.message, styles.error)}>Error loading requests</div>;
  }
  if (rows.length === 0) {
    return <div className={styles.message}>No requests yet</div>;
  }

  return (
    <Fragment>
      {rows.map((row) => (
        <BookRequestRow
          key={row.id}
          request={row}
          canResolve
          onDelete={handleDelete}
          target={target}
        />
      ))}
      {hasNextPage && (
        <Button type="link" onClick={loadMore} loading={loadingMore}>
          Load more
        </Button>
      )}
      {error && rows.length > 0 && (
        <div className={cx(styles.message, styles.error)}>
          Failed to load more requests
          <Button type="link" onClick={loadMore}>
            Retry
          </Button>
        </div>
      )}
    </Fragment>
  );
};
